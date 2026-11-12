// Propriétaire : Dev A
// POST /api/simulators/generate : génère un simulateur YAML à partir d'une description en français.
// Logs : provider, attempts, durée, statut uniquement. JAMAIS la description, le YAML ni les clés.
//
// Variables d'environnement :
//   AI_GENERATION_ENABLED   "false" coupe l'assistant (503 ai_disabled, aucun appel IA) ; défaut "true"
//   AI_DAILY_LIMIT          plafond global de générations par jour UTC ; défaut 100
//   AI_REQUEST_DEADLINE_MS  échéance globale d'une requête ; défaut 90000 (504 ai_timeout au-delà)
//   VALKEY_URL              compteurs de quota persistants (sinon en mémoire)
import type { FastifyPluginAsync } from "fastify";
import { AiUnavailableError, generateSimulator } from "./generate.js";
import { maskSensitive } from "./mask.js";
import { buildSystemPrompt, buildUserPrompt, loadExampleYaml, type SimulatorKind } from "./prompt.js";
import { createCallContext, createProviders, GenerationAbortedError } from "./providers.js";
import { createQuotaFromEnv, type AiQuota } from "./quota.js";

export interface AiRoutesOptions {
  /** Variables d'environnement (par défaut process.env) ; injectables pour les tests. */
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  quota?: AiQuota;
  /** Exemple de simulateur ; par défaut lu dans simulators/paiement-mobile-generique.yaml. */
  exampleYaml?: string;
}

export const DEFAULT_DEADLINE_MS = 90_000;
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
  const enabled = env.AI_GENERATION_ENABLED !== "false";
  const deadlineValue = Number(env.AI_REQUEST_DEADLINE_MS);
  const deadlineMs = Number.isFinite(deadlineValue) && deadlineValue > 0 ? deadlineValue : DEFAULT_DEADLINE_MS;
  const providers = createProviders(env, opts.fetch ?? fetch);
  const quota = opts.quota ?? createQuotaFromEnv(env, app.log);
  if (!opts.quota) app.addHook("onClose", async () => quota.close());

  const example = opts.exampleYaml ?? loadExampleYaml();
  if (!example) app.log.warn("Assistant IA : exemple de simulateur introuvable, prompt sans exemple");
  const system = buildSystemPrompt(example);
  app.log.info(
    { providers: providers.map((p) => p.name), enabled, dailyLimit: quota.dailyLimit, deadlineMs },
    "Assistant IA : configuration",
  );

  app.post("/api/simulators/generate", async (req, reply) => {
    const started = Date.now();
    const body = parseBody(req.body);
    if (!body.ok) return reply.code(400).send({ error: "invalid_body", message: body.message });

    if (!enabled) {
      req.log.info({ status: 503 }, "génération IA désactivée (AI_GENERATION_ENABLED=false)");
      return reply.code(503).send({ error: "ai_disabled" });
    }
    if (providers.length === 0) {
      req.log.warn({ status: 503 }, "génération IA indisponible : aucune clé configurée");
      return reply.code(503).send({ error: "ai_unavailable" });
    }

    // req.ip tient compte de X-Forwarded-For grâce à trustProxy (Caddy est devant l'API).
    const q = await quota.consume(req.ip);
    if (!q.ok) {
      req.log.info({ status: 429, error: q.error }, "génération IA : quota dépassé");
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
        { provider: result.provider, attempts: result.attempts, durationMs: Date.now() - started, status },
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
