// Propriétaire : Dev A
// POST /api/simulators/generate : génère un simulateur YAML à partir d'une description en français.
// Réservé aux utilisateurs connectés. Ordre des contrôles : session (401) → interrupteur (503) →
// quota du compte → quota de l'IP → plafond global (429) → appel IA.
// Logs : provider, attempts, durée, statut, id du compte uniquement. JAMAIS la description, le YAML,
// les clés ni l'email du compte.
//
// Variables d'environnement :
//   AI_GENERATION_ENABLED   activé seulement si "true", "1" ou "yes" (casse et espaces ignorés) ; absente ou
//                           toute autre valeur = désactivé (503 ai_disabled, aucun appel IA)
//   AI_USER_DAILY_LIMIT     générations par compte et par jour UTC ; défaut 20
//   AI_DAILY_LIMIT          plafond global de générations par jour UTC ; défaut 100
//   AI_REQUEST_DEADLINE_MS  échéance globale d'une requête ; défaut 90000 (504 ai_timeout au-delà)
//   VALKEY_URL              compteurs de quota persistants (sinon en mémoire)
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { requireUser, type AuthenticatedUser } from "../auth.js";
import { AiUnavailableError, generateSimulator } from "./generate.js";
import { maskSensitive } from "./mask.js";
import { buildSystemPrompt, buildUserPrompt, loadExampleYaml, type SimulatorKind } from "./prompt.js";
import { createCallContext, createProviders, GenerationAbortedError } from "./providers.js";
import { createQuotaFromEnv, type AiQuota } from "./quota.js";

/** Dépendances remplaçables dans les tests (même principe que PhoneActionDeps), sans Better Auth. */
export interface AiRoutesDeps {
  requireUser: (req: FastifyRequest) => Promise<AuthenticatedUser | null>;
}

const defaultDeps: AiRoutesDeps = { requireUser };

export interface AiRoutesOptions {
  deps?: AiRoutesDeps;
  /** Variables d'environnement (par défaut process.env) ; injectables pour les tests. */
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  quota?: AiQuota;
  /** Exemple de simulateur ; par défaut lu dans simulators/paiement-mobile-generique.yaml. */
  exampleYaml?: string;
}

export const DEFAULT_DEADLINE_MS = 90_000;

/** L'assistant est désactivé par défaut : seules "true", "1" et "yes" l'activent (casse et espaces ignorés). */
export function isGenerationEnabled(value: string | undefined): boolean {
  return ["true", "1", "yes"].includes((value ?? "").trim().toLowerCase());
}
const MIN_DESCRIPTION = 10;
const MAX_DESCRIPTION = 2000;
const NOTICE = "Généré par IA, à vérifier";

type ParsedBody = { ok: true; description: string; kind?: SimulatorKind } | { ok: false; message: string };

function parseBody(body: unknown): ParsedBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, message: "Corps JSON attendu." };
  const { description, kind } = body as { description?: unknown; kind?: unknown };
  if (typeof description !== "string") return { ok: false, message: "Champ 'description' manquant." };
  const length = [...description.trim()].length;
  if (length < MIN_DESCRIPTION || length > MAX_DESCRIPTION) {
    return { ok: false, message: `'description' doit faire entre ${MIN_DESCRIPTION} et ${MAX_DESCRIPTION} caractères.` };
  }
  if (kind !== undefined && kind !== "http" && kind !== "ussd") {
    return { ok: false, message: "'kind' doit valoir \"http\" ou \"ussd\"." };
  }
  return { ok: true, description, kind };
}

export const aiRoutes: FastifyPluginAsync<AiRoutesOptions> = async (app, opts) => {
  const env = opts.env ?? process.env;
  const deps = opts.deps ?? defaultDeps;
  const enabled = isGenerationEnabled(env.AI_GENERATION_ENABLED);
  app.log.info(enabled ? "Assistant IA : activé" : "Assistant IA : désactivé (AI_GENERATION_ENABLED)");
  const deadlineValue = Number(env.AI_REQUEST_DEADLINE_MS);
  const deadlineMs = Number.isFinite(deadlineValue) && deadlineValue > 0 ? deadlineValue : DEFAULT_DEADLINE_MS;
  const providers = createProviders(env, opts.fetch ?? fetch);
  const quota = opts.quota ?? createQuotaFromEnv(env, app.log);
  if (!opts.quota) app.addHook("onClose", async () => quota.close());

  const example = opts.exampleYaml ?? loadExampleYaml();
  if (!example) app.log.warn("Assistant IA : exemple de simulateur introuvable, prompt sans exemple");
  const system = buildSystemPrompt(example);
  app.log.info(
    { providers: providers.map((p) => p.name), enabled, dailyLimit: quota.dailyLimit, userDailyLimit: quota.userDailyLimit, deadlineMs },
    "Assistant IA : configuration",
  );

  app.post("/api/simulators/generate", async (req, reply) => {
    const started = Date.now();

    // 1. Session, avant tout le reste : sans compte, ni quota consommé ni appel IA.
    let user: AuthenticatedUser | null;
    try {
      user = await deps.requireUser(req);
    } catch {
      // Pas de détail d'erreur dans les logs : une erreur de base pourrait transporter des données du compte.
      req.log.error({ status: 503 }, "génération IA : vérification de la session impossible");
      return reply.code(503).send({ error: "auth_unavailable" });
    }
    if (!user) {
      req.log.info({ status: 401 }, "génération IA refusée : pas de session");
      return reply.code(401).send({ error: "auth_required" });
    }
    const userId = user.id; // seul identifiant du compte écrit dans les logs (jamais l'email)

    const body = parseBody(req.body);
    if (!body.ok) return reply.code(400).send({ error: "invalid_body", message: body.message });

    if (!enabled) {
      req.log.info({ status: 503 }, "génération IA désactivée (AI_GENERATION_ENABLED)");
      return reply.code(503).send({ error: "ai_disabled" });
    }
    if (providers.length === 0) {
      req.log.warn({ status: 503 }, "génération IA indisponible : aucune clé configurée");
      return reply.code(503).send({ error: "ai_unavailable" });
    }

    // req.ip tient compte de X-Forwarded-For grâce à trustProxy (Caddy est devant l'API).
    const q = await quota.consume(req.ip, userId);
    if (!q.ok) {
      req.log.info({ userId, status: 429, error: q.error }, "génération IA : quota dépassé");
      return reply.code(429).header("Retry-After", String(q.retryAfter)).send({ error: q.error, retryAfter: q.retryAfter });
    }

    // Annulation : le client se déconnecte avant la réponse, ou l'échéance globale est atteinte.
    const disconnect = new AbortController();
    const onClose = () => {
      if (!reply.raw.writableEnded) disconnect.abort(new GenerationAbortedError("client_closed"));
    };
    reply.raw.on("close", onClose);
    const signal = AbortSignal.any([disconnect.signal, AbortSignal.timeout(deadlineMs)]);

    try {
      const result = await generateSimulator({
        providers,
        system,
        userPrompt: buildUserPrompt(maskSensitive(body.description), body.kind),
        kind: body.kind,
        onProviderError: (provider, reason) => req.log.warn({ provider, reason }, "fournisseur IA en échec"),
        log: req.log,
        ctx: createCallContext(signal),
      });
      const status = result.valid ? 200 : 422;
      req.log.info(
        { userId, provider: result.provider, attempts: result.attempts, durationMs: Date.now() - started, status },
        "génération IA terminée",
      );
      if (result.valid) {
        return reply.code(200).send({
          valid: true,
          yaml: result.yaml,
          provider: result.provider,
          attempts: result.attempts,
          aiGenerated: true,
          notice: NOTICE,
        });
      }
      return reply.code(422).send({
        valid: false,
        errors: result.errors,
        yaml: result.yaml,
        provider: result.provider,
        attempts: result.attempts,
        aiGenerated: true,
        notice: NOTICE,
      });
    } catch (err) {
      const durationMs = Date.now() - started;
      if (err instanceof GenerationAbortedError && err.reason === "deadline") {
        req.log.warn({ durationMs, status: 504 }, "génération IA : échéance globale dépassée");
        return reply.code(504).send({ error: "ai_timeout" });
      }
      if (err instanceof GenerationAbortedError && err.reason === "client_closed") {
        // Le client est parti : personne ne lira la réponse (499 = convention « client closed request »).
        req.log.info({ durationMs, status: 499 }, "génération IA annulée : client déconnecté");
        return reply.code(499).send({ error: "client_closed" });
      }
      if (!(err instanceof AiUnavailableError)) throw err;
      req.log.warn({ durationMs, status: 503 }, "génération IA : tous les fournisseurs ont échoué");
      return reply.code(503).send({ error: "ai_unavailable" });
    } finally {
      reply.raw.off("close", onClose);
    }
  });
};
