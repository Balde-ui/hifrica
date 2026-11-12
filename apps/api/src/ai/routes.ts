// Propriétaire : Dev A
// POST /api/simulators/generate : génère un simulateur YAML à partir d'une description en français.
// Logs : provider, attempts, durée, statut uniquement. JAMAIS la description, le YAML ni les clés.
import type { FastifyPluginAsync } from "fastify";
import { AiUnavailableError, generateSimulator } from "./generate.js";
import { maskSensitive } from "./mask.js";
import { buildSystemPrompt, buildUserPrompt, loadExampleYaml, type SimulatorKind } from "./prompt.js";
import { createProviders } from "./providers.js";
import { Quota } from "./quota.js";

export interface AiRoutesOptions {
  /** Variables d'environnement (par défaut process.env) ; injectables pour les tests. */
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  quota?: Quota;
  /** Exemple de simulateur ; par défaut lu dans simulators/paiement-mobile-generique.yaml. */
  exampleYaml?: string;
}

const MIN_DESCRIPTION = 10;
const MAX_DESCRIPTION = 2000;

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
  const providers = createProviders(opts.env ?? process.env, opts.fetch ?? fetch);
  const quota = opts.quota ?? new Quota();
  const example = opts.exampleYaml ?? loadExampleYaml();
  if (!example) app.log.warn("Assistant IA : exemple de simulateur introuvable, prompt sans exemple");
  const system = buildSystemPrompt(example);
  app.log.info({ providers: providers.map((p) => p.name) }, "Assistant IA : fournisseurs configurés");

  app.post("/api/simulators/generate", async (req, reply) => {
    const started = Date.now();
    const body = parseBody(req.body);
    if (!body.ok) return reply.code(400).send({ error: "invalid_body", message: body.message });

    if (providers.length === 0) {
      req.log.warn({ status: 503 }, "génération IA indisponible : aucune clé configurée");
      return reply.code(503).send({ error: "ai_unavailable" });
    }

    // req.ip tient compte de X-Forwarded-For grâce à trustProxy (Caddy est devant l'API).
    const q = quota.consume(req.ip);
    if (!q.ok) {
      req.log.info({ status: 429 }, "génération IA : quota dépassé");
      return reply.code(429).header("Retry-After", String(q.retryAfter)).send({ error: "quota_exceeded", retryAfter: q.retryAfter });
    }

    try {
      const result = await generateSimulator({
        providers,
        system,
        userPrompt: buildUserPrompt(maskSensitive(body.description), body.kind),
        kind: body.kind,
        onProviderError: (provider, reason) => req.log.warn({ provider, reason }, "fournisseur IA en échec"),
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
          notice: "Généré par IA, à vérifier",
        });
      }
      return reply.code(422).send({
        valid: false,
        errors: result.errors,
        yaml: result.yaml,
        provider: result.provider,
        attempts: result.attempts,
      });
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
      req.log.warn({ durationMs: Date.now() - started, status: 503 }, "génération IA : tous les fournisseurs ont échoué");
      return reply.code(503).send({ error: "ai_unavailable" });
    }
  });
};
