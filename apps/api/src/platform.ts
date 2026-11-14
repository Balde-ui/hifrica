// Propriétaire : Dev C (C2 comptes et projets, C4 console, C5 catalogue)
// Routes de la plateforme, toutes sous /api et authentifiées par la session Better Auth.
// Règles : aucune clé complète stockée ni renvoyée après sa création ; 404 (jamais 403) pour un
// projet d'un autre utilisateur ; erreurs de base converties par safeDbCall (aucune valeur divulguée).
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq, ilike, isNull, lt, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  apiKeys,
  decryptWebhookSecret,
  encryptWebhookSecret,
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
  isDbOperationError,
  isSlug,
  isUuid,
  parseApiId,
  projectSimulators,
  projects,
  requestLogs,
  safeDbCall,
  simulators,
  simulatorVersions,
  toApiId,
  type Database,
  type WebhookSecretKeyring,
} from "@hifrica/db";
import { validateSimulatorYaml } from "@hifrica/shared";
import { assertProjectOwner, requireUser, type AuthenticatedUser } from "./auth.js";
import { registerDemoWebhooks } from "./demo-webhooks.js";
import { summarize } from "./simulator-summary.js";

export interface PlatformOptions {
  db: Database;
  keyring: WebhookSecretKeyring | null;
  /** URL interne du moteur (réseau Docker), pour les envois de la console. */
  engineUrl: string;
  /** URL publique du moteur, affichée dans l'interface (exemples cURL). */
  publicEngineUrl: string;
  simulatorsDir: string;
}

const MAX_KEYS_PER_PROJECT = 10;
const MAX_PROJECTS_PER_USER = 20;
const SEND_TIMEOUT_MS = 35_000;

type Reply = FastifyReply;

function fail(reply: Reply, status: number, error: string, message?: string) {
  return reply.code(status).send(message ? { error, message } : { error });
}

async function userOr401(req: FastifyRequest, reply: Reply): Promise<AuthenticatedUser | null> {
  const user = await requireUser(req);
  if (!user) {
    fail(reply, 401, "unauthenticated", "Connectez-vous pour continuer.");
    return null;
  }
  return user;
}

/** Utilisateur + projet possédé, ou réponse d'erreur déjà envoyée. */
async function ownedProject(req: FastifyRequest<{ Params: { id: string } }>, reply: Reply) {
  const user = await userOr401(req, reply);
  if (!user) return null;
  const projectId = req.params.id;
  if (!(await assertProjectOwner(user, projectId))) {
    fail(reply, 404, "project_not_found", "Projet introuvable.");
    return null;
  }
  return { user, projectId };
}

function cleanName(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && [...name].length <= max ? name : null;
}

/** URL de webhook : http(s), 2048 caractères au plus. null = supprimer ; undefined = invalide. */
function cleanWebhookUrl(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function keyView(k: typeof apiKeys.$inferSelect) {
  return {
    id: k.id,
    name: k.name,
    display: `${k.prefix}…${k.last4}`,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    revokedAt: k.revokedAt,
  };
}

/**
 * Importe en base les simulateurs livrés avec le dépôt (dossier simulators/), pour que le catalogue,
 * le choix du scénario et les journaux s'appuient sur des lignes réelles. Idempotent : une nouvelle
 * version n'est créée que si le YAML du fichier a changé (simulateurs sans propriétaire uniquement).
 */
export async function seedSimulators(db: Database, dir: string, log: (msg: string) => void): Promise<void> {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  } catch {
    log(`catalogue : dossier ${dir} introuvable, aucun simulateur importé`);
    return;
  }
  for (const file of files) {
    const yaml = readFileSync(join(dir, file), "utf8");
    const result = validateSimulatorYaml(yaml);
    if (!result.valid) {
      log(`catalogue : ${file} invalide, ignoré`);
      continue;
    }
    const sim = result.simulator as { name: string; kind: "http" | "ussd"; version: string; description?: string };
    await safeDbCall("seed_simulators", () =>
      db.transaction(async (tx) => {
        const [existing] = await tx.select().from(simulators).where(eq(simulators.slug, sim.name)).limit(1);
        if (existing && existing.ownerId !== null) return; // simulateur d'un utilisateur : jamais écrasé
        const id = existing?.id ?? randomUUID();
        if (!existing) {
          await tx.insert(simulators).values({
            id,
            slug: sim.name,
            kind: sim.kind,
            description: sim.description ?? null,
            origin: "manual",
            status: "verified",
            publishedAt: new Date(),
          });
        }
        const [current] = await tx
          .select()
          .from(simulatorVersions)
          .where(and(eq(simulatorVersions.simulatorId, id), eq(simulatorVersions.isCurrent, true)))
          .limit(1);
        if (current && current.yaml === yaml) return;
        if (current) {
          await tx.update(simulatorVersions).set({ isCurrent: false }).where(eq(simulatorVersions.id, current.id));
        }
        const [same] = await tx
          .select({ id: simulatorVersions.id })
          .from(simulatorVersions)
          .where(and(eq(simulatorVersions.simulatorId, id), eq(simulatorVersions.version, sim.version)))
          .limit(1);
        if (same) {
          await tx.update(simulatorVersions).set({ isCurrent: true, yaml }).where(eq(simulatorVersions.id, same.id));
        } else {
          await tx.insert(simulatorVersions).values({ simulatorId: id, version: sim.version, yaml, isCurrent: true });
        }
        await tx.update(simulators).set({ description: sim.description ?? null, kind: sim.kind }).where(eq(simulators.id, id));
        log(`catalogue : ${sim.name} ${sim.version} importé`);
      }),
    );
  }
}

export function registerPlatformRoutes(app: FastifyInstance, opts: PlatformOptions): void {
  const { db } = opts;

  // Erreurs de base : jamais de détail. Une violation d'unicité ou de contrainte reste une 409/400 lisible.
  app.setErrorHandler((err, req, reply) => {
    if (isDbOperationError(err)) {
      req.log.error({ err }, "erreur de base de données");
      if (err.kind === "unique_violation") return fail(reply, 409, "conflict", "Cette valeur existe déjà.");
      if (err.kind === "check_violation" || err.kind === "invalid_input") {
        return fail(reply, 400, "invalid_input", "Valeur refusée.");
      }
      return fail(reply, 503, "database_unavailable", "Base de données indisponible, réessayez.");
    }
    if ((err as { statusCode?: number }).statusCode === 400) {
      return fail(reply, 400, "invalid_body", "Requête mal formée.");
    }
    req.log.error({ err }, "erreur inattendue");
    return fail(reply, 500, "internal_error", "Erreur interne.");
  });

  // ---------------------------------------------------------------------------------------------
  // Compte
  // ---------------------------------------------------------------------------------------------
  app.get("/api/me", async (req, reply) => {
    const user = await userOr401(req, reply);
    if (!user) return;
    return { user, github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) };
  });

  app.get("/api/config", async () => ({
    engineUrl: opts.publicEngineUrl,
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  }));

  // ---------------------------------------------------------------------------------------------
  // Projets
  // ---------------------------------------------------------------------------------------------
  app.get("/api/projects", async (req, reply) => {
    const user = await userOr401(req, reply);
    if (!user) return;
    const rows = await safeDbCall("list_projects", () =>
      db
        .select({
          id: projects.id,
          name: projects.name,
          webhookUrl: projects.webhookUrl,
          createdAt: projects.createdAt,
          // Noms qualifiés écrits explicitement : dans une sous-requête, Drizzle rendrait projects.id par
          // "id" seul, que PostgreSQL rattacherait à api_keys.id (le compte valait toujours 0).
          activeKeys: sql<number>`(SELECT count(*)::int FROM "api_keys" k WHERE k."project_id" = "projects"."id" AND k."revoked_at" IS NULL)`,
        })
        .from(projects)
        .where(eq(projects.ownerId, user.id))
        .orderBy(desc(projects.createdAt)),
    );
    return { projects: rows };
  });

  app.post<{ Body: { name?: unknown; webhookUrl?: unknown } }>("/api/projects", async (req, reply) => {
    const user = await userOr401(req, reply);
    if (!user) return;
    if (!opts.keyring) return fail(reply, 503, "webhook_keys_missing", "Configuration serveur incomplète (WEBHOOK_SECRET_KEYS).");
    const name = cleanName(req.body?.name, 80);
    if (!name) return fail(reply, 400, "invalid_name", "Nom de projet requis (80 caractères au plus).");
    const webhookUrl = req.body?.webhookUrl === undefined ? null : cleanWebhookUrl(req.body.webhookUrl);
    if (webhookUrl === undefined) return fail(reply, 400, "invalid_webhook_url", "URL de webhook invalide (http ou https).");

    const [{ count }] = await safeDbCall("list_projects", () =>
      db.select({ count: sql<number>`count(*)::int` }).from(projects).where(eq(projects.ownerId, user.id)),
    );
    if (count >= MAX_PROJECTS_PER_USER) return fail(reply, 409, "project_limit", `${MAX_PROJECTS_PER_USER} projets au plus.`);

    const id = randomUUID();
    const secret = generateWebhookSecret();
    await safeDbCall("create_project", () =>
      db.insert(projects).values({
        id,
        ownerId: user.id,
        name,
        webhookUrl,
        webhookSecretEnc: encryptWebhookSecret(secret, id, opts.keyring!),
      }),
    );
    return reply.code(201).send({ project: { id, name, webhookUrl } });
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const owned = await ownedProject(req, reply);
    if (!owned) return;
    const [project] = await safeDbCall("get_project", () =>
      db
        .select({ id: projects.id, name: projects.name, webhookUrl: projects.webhookUrl, createdAt: projects.createdAt })
        .from(projects)
        .where(eq(projects.id, owned.projectId)),
    );
    const keys = await safeDbCall("list_api_keys", () =>
      db.select().from(apiKeys).where(eq(apiKeys.projectId, owned.projectId)).orderBy(desc(apiKeys.createdAt)),
    );
    const active = await safeDbCall("get_active_scenario", () =>
      db
        .select({ slug: simulators.slug, scenario: projectSimulators.activeScenarioKey })
        .from(projectSimulators)
        .innerJoin(simulators, eq(simulators.id, projectSimulators.simulatorId))
        .where(eq(projectSimulators.projectId, owned.projectId)),
    );
    return { project, keys: keys.map(keyView), scenarios: Object.fromEntries(active.map((a) => [a.slug, a.scenario])) };
  });

  app.patch<{ Params: { id: string }; Body: { name?: unknown; webhookUrl?: unknown } }>("/api/projects/:id", async (req, reply) => {
    const owned = await ownedProject(req, reply);
    if (!owned) return;
    const patch: { name?: string; webhookUrl?: string | null; updatedAt: Date } = { updatedAt: new Date() };
    if (req.body?.name !== undefined) {
      const name = cleanName(req.body.name, 80);
      if (!name) return fail(reply, 400, "invalid_name", "Nom de projet requis (80 caractères au plus).");
      patch.name = name;
    }
    if (req.body?.webhookUrl !== undefined) {
      const url = cleanWebhookUrl(req.body.webhookUrl);
      if (url === undefined) return fail(reply, 400, "invalid_webhook_url", "URL de webhook invalide (http ou https).");
      patch.webhookUrl = url;
    }
    await safeDbCall("update_project", () => db.update(projects).set(patch).where(eq(projects.id, owned.projectId)));
    return { ok: true };
  });

  /** Secret de signature des webhooks (HMAC), déchiffré à la demande du propriétaire seulement. */
  app.get<{ Params: { id: string } }>("/api/projects/:id/webhook-secret", async (req, reply) => {
    const owned = await ownedProject(req, reply);
    if (!owned) return;
    if (!opts.keyring) return fail(reply, 503, "webhook_keys_missing", "Configuration serveur incomplète (WEBHOOK_SECRET_KEYS).");
    const [row] = await safeDbCall("get_project", () =>
      db.select({ id: projects.id, enc: projects.webhookSecretEnc }).from(projects).where(eq(projects.id, owned.projectId)),
    );
    reply.header("cache-control", "no-store");
    return { secret: decryptWebhookSecret(row.enc, row.id, opts.keyring) };
  });

  // ---------------------------------------------------------------------------------------------
  // Clés de test
  // ---------------------------------------------------------------------------------------------
  app.post<{ Params: { id: string }; Body: { name?: unknown } }>("/api/projects/:id/keys", async (req, reply) => {
    const owned = await ownedProject(req, reply);
    if (!owned) return;
    const name = req.body?.name === undefined || req.body.name === "" ? null : cleanName(req.body.name, 60);
    if (name === null && req.body?.name !== undefined && req.body.name !== "") {
      return fail(reply, 400, "invalid_name", "Nom de clé : 60 caractères au plus.");
    }
    const [{ count }] = await safeDbCall("list_api_keys", () =>
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(apiKeys)
        .where(and(eq(apiKeys.projectId, owned.projectId), isNull(apiKeys.revokedAt))),
    );
    if (count >= MAX_KEYS_PER_PROJECT) return fail(reply, 409, "key_limit", `${MAX_KEYS_PER_PROJECT} clés actives au plus.`);
    const generated = generateApiKey();
    const [row] = await safeDbCall("create_api_key", () =>
      db
        .insert(apiKeys)
        .values({
          projectId: owned.projectId,
          name,
          keyHash: generated.hash,
          prefix: generated.prefix,
          last4: generated.last4,
          createdBy: owned.user.id,
        })
        .returning(),
    );
    reply.header("cache-control", "no-store");
    // La clé complète n'est renvoyée qu'ici, une seule fois. Elle n'est ni stockée ni journalisée.
    return reply.code(201).send({ key: generated.key, apiKey: keyView(row) });
  });

  app.delete<{ Params: { id: string; keyId: string } }>("/api/projects/:id/keys/:keyId", async (req, reply) => {
    const owned = await ownedProject(req, reply);
    if (!owned) return;
    if (!isUuid(req.params.keyId)) return fail(reply, 404, "key_not_found", "Clé introuvable.");
    const rows = await safeDbCall("revoke_api_key", () =>
      db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, req.params.keyId), eq(apiKeys.projectId, owned.projectId), isNull(apiKeys.revokedAt)))
        .returning({ id: apiKeys.id }),
    );
    if (rows.length === 0) return fail(reply, 404, "key_not_found", "Clé introuvable ou déjà révoquée.");
    return { ok: true };
  });

  // ---------------------------------------------------------------------------------------------
  // Scénario actif (par simulateur)
  // ---------------------------------------------------------------------------------------------
  app.put<{ Params: { id: string }; Body: { simulator?: unknown; scenario?: unknown } }>(
    "/api/projects/:id/scenario",
    async (req, reply) => {
      const owned = await ownedProject(req, reply);
      if (!owned) return;
      const slug = req.body?.simulator;
      if (!isSlug(slug)) return fail(reply, 400, "invalid_simulator", "Simulateur invalide.");
      const scenario = req.body?.scenario === null || req.body?.scenario === "" ? null : req.body?.scenario;
      if (scenario !== null && typeof scenario !== "string") return fail(reply, 400, "invalid_scenario", "Scénario invalide.");

      const [sim] = await safeDbCall("get_simulator", () =>
        db
          .select({ id: simulators.id, yaml: simulatorVersions.yaml })
          .from(simulators)
          .innerJoin(simulatorVersions, and(eq(simulatorVersions.simulatorId, simulators.id), eq(simulatorVersions.isCurrent, true)))
          .where(eq(simulators.slug, slug)),
      );
      if (!sim) return fail(reply, 404, "simulator_not_found", "Simulateur introuvable.");
      if (scenario !== null) {
        const parsed = validateSimulatorYaml(sim.yaml);
        const keys = parsed.valid ? Object.keys((parsed.simulator as { scenarios?: object }).scenarios ?? {}) : [];
        if (!keys.includes(scenario)) return fail(reply, 400, "unknown_scenario", "Ce scénario n'existe pas dans le simulateur.");
      }
      await safeDbCall("set_active_scenario", () =>
        db
          .insert(projectSimulators)
          .values({ projectId: owned.projectId, simulatorId: sim.id, activeScenarioKey: scenario })
          .onConflictDoUpdate({
            target: [projectSimulators.projectId, projectSimulators.simulatorId],
            set: { activeScenarioKey: scenario, updatedAt: new Date() },
          }),
      );
      return { ok: true, simulator: slug, scenario };
    },
  );

  // ---------------------------------------------------------------------------------------------
  // Console : journal des requêtes (métadonnées seulement, aucun corps)
  // ---------------------------------------------------------------------------------------------
  app.get<{ Params: { id: string }; Querystring: { before?: string; limit?: string } }>(
    "/api/projects/:id/logs",
    async (req, reply) => {
      const owned = await ownedProject(req, reply);
      if (!owned) return;
      const before = req.query.before === undefined ? null : parseApiId(req.query.before);
      if (req.query.before !== undefined && before === null) return fail(reply, 400, "invalid_cursor", "Curseur invalide.");
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit ?? "50", 10) || 50, 1), 100);
      const rows = await safeDbCall("list_request_logs", () =>
        db
          .select({
            id: requestLogs.id,
            requestId: requestLogs.requestId,
            simulator: requestLogs.simulatorSlug,
            channel: requestLogs.channel,
            source: requestLogs.source,
            outcome: requestLogs.outcome,
            endpointId: requestLogs.endpointId,
            scenarioKey: requestLogs.scenarioKey,
            sessionId: requestLogs.sessionId,
            method: requestLogs.method,
            path: requestLogs.path,
            status: requestLogs.status,
            errorCode: requestLogs.errorCode,
            durationMs: requestLogs.durationMs,
            response: requestLogs.response,
            createdAt: requestLogs.createdAt,
            apiKeyId: requestLogs.apiKeyId,
          })
          .from(requestLogs)
          .where(
            and(eq(requestLogs.projectId, owned.projectId), before === null ? undefined : lt(requestLogs.id, before)),
          )
          .orderBy(desc(requestLogs.id))
          .limit(limit + 1),
      );
      const page = rows.slice(0, limit).map((r) => ({ ...r, id: toApiId(r.id) }));
      return { logs: page, next: rows.length > limit ? page[page.length - 1].id : null };
    },
  );

  // ---------------------------------------------------------------------------------------------
  // Console : envoyer une requête au simulateur avec une clé de test du projet
  // ---------------------------------------------------------------------------------------------
  app.post<{
    Params: { id: string };
    Body: { key?: unknown; simulator?: unknown; method?: unknown; path?: unknown; body?: unknown; scenario?: unknown };
  }>("/api/projects/:id/send", async (req, reply) => {
    const owned = await ownedProject(req, reply);
    if (!owned) return;
    const { key, simulator, method, path, body, scenario } = req.body ?? {};
    if (typeof key !== "string" || !/^sk_test_[0-9A-Za-z]{43}$/.test(key)) {
      return fail(reply, 400, "invalid_key", "Clé de test invalide (sk_test_…).");
    }
    if (!isSlug(simulator)) return fail(reply, 400, "invalid_simulator", "Simulateur invalide.");
    const m = typeof method === "string" ? method.toUpperCase() : "";
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(m)) return fail(reply, 400, "invalid_method", "Méthode invalide.");
    if (typeof path !== "string" || !path.startsWith("/") || path.length > 512 || /\s|\.\.|\/\//.test(path)) {
      return fail(reply, 400, "invalid_path", "Chemin invalide.");
    }
    if (scenario !== undefined && scenario !== null && (typeof scenario !== "string" || !/^[A-Za-z0-9_-]{1,60}$/.test(scenario))) {
      return fail(reply, 400, "invalid_scenario", "Scénario invalide.");
    }
    // La clé doit appartenir à CE projet et être active (pas de relais pour la clé d'un autre).
    const [found] = await safeDbCall("resolve_api_key", () =>
      db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.projectId, owned.projectId),
            eq(apiKeys.keyHash, hashApiKey(key)),
            isNull(apiKeys.revokedAt),
          ),
        ),
    );
    if (!found) return fail(reply, 400, "key_not_in_project", "Cette clé n'est pas une clé active de ce projet.");

    // Base fixe (moteur interne) + slug validé + chemin validé : aucune redirection possible ailleurs.
    const url = new URL(`${opts.engineUrl.replace(/\/$/, "")}/${simulator}${path}`);
    const headers: Record<string, string> = { authorization: `Bearer ${key}` };
    if (typeof scenario === "string") headers["x-hifrica-scenario"] = scenario;
    let payload: string | undefined;
    if (m !== "GET" && m !== "DELETE" && body !== undefined) {
      payload = JSON.stringify(body);
      if (payload.length > 64 * 1024) return fail(reply, 400, "body_too_large", "Corps trop volumineux (64 Ko).");
      headers["content-type"] = "application/json";
    }
    const started = Date.now();
    try {
      const res = await fetch(url, { method: m, headers, body: payload, redirect: "manual", signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* réponse non json : renvoyée en texte */
      }
      return {
        status: res.status,
        durationMs: Date.now() - started,
        requestId: res.headers.get("x-hifrica-request-id"),
        contentType: res.headers.get("content-type"),
        body: typeof parsed === "string" ? parsed.slice(0, 64 * 1024) : parsed,
      };
    } catch (err) {
      const timeout = err instanceof Error && err.name === "TimeoutError";
      return fail(reply, 502, timeout ? "engine_timeout" : "engine_unreachable", timeout ? "Le simulateur n'a pas répondu à temps." : "Moteur de simulation injoignable.");
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Catalogue
  // ---------------------------------------------------------------------------------------------
  app.get<{ Querystring: { q?: string; kind?: string } }>("/api/simulators", async (req) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
    const kind = req.query.kind === "http" || req.query.kind === "ussd" ? req.query.kind : null;
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await safeDbCall("list_simulators", () =>
      db
        .select({
          slug: simulators.slug,
          kind: simulators.kind,
          description: simulators.description,
          origin: simulators.origin,
          status: simulators.status,
          publishedAt: simulators.publishedAt,
          version: simulatorVersions.version,
          yaml: simulatorVersions.yaml,
        })
        .from(simulators)
        .innerJoin(simulatorVersions, and(eq(simulatorVersions.simulatorId, simulators.id), eq(simulatorVersions.isCurrent, true)))
        .where(
          and(
            sql`${simulators.status} <> 'unpublished'`,
            sql`${simulators.publishedAt} IS NOT NULL`,
            kind ? eq(simulators.kind, kind) : undefined,
            q ? or(ilike(simulators.slug, pattern), ilike(simulators.description, pattern)) : undefined,
          ),
        )
        .orderBy(desc(simulators.publishedAt))
        .limit(100),
    );
    return { simulators: rows.map(summarize) };
  });

  app.get<{ Params: { slug: string } }>("/api/simulators/:slug", async (req, reply) => {
    if (!isSlug(req.params.slug)) return fail(reply, 404, "simulator_not_found", "Simulateur introuvable.");
    const [row] = await safeDbCall("get_simulator", () =>
      db
        .select({
          slug: simulators.slug,
          kind: simulators.kind,
          description: simulators.description,
          origin: simulators.origin,
          status: simulators.status,
          publishedAt: simulators.publishedAt,
          version: simulatorVersions.version,
          yaml: simulatorVersions.yaml,
          forkedFromId: simulators.forkedFromId,
        })
        .from(simulators)
        .innerJoin(simulatorVersions, and(eq(simulatorVersions.simulatorId, simulators.id), eq(simulatorVersions.isCurrent, true)))
        .where(and(eq(simulators.slug, req.params.slug), sql`${simulators.publishedAt} IS NOT NULL`)),
    );
    if (!row) return fail(reply, 404, "simulator_not_found", "Simulateur introuvable.");
    let forkedFrom: string | null = null;
    if (row.forkedFromId) {
      const [parent] = await safeDbCall("get_simulator", () =>
        db.select({ slug: simulators.slug }).from(simulators).where(eq(simulators.id, row.forkedFromId!)),
      );
      forkedFrom = parent?.slug ?? null;
    }
    return { simulator: { ...summarize({ ...row, forkedFrom }), yaml: row.yaml }, engineUrl: opts.publicEngineUrl };
  });

  /**
   * Publier un simulateur : YAML validé côté serveur (même schéma que l'éditeur et le moteur).
   * origin "ai" → statut « à vérifier » (badge « Généré par IA, à vérifier ») ; sinon « brouillon publié ».
   * Un slug déjà pris par quelqu'un d'autre est refusé ; son propriétaire peut publier une nouvelle version.
   */
  app.post<{ Body: { yaml?: unknown; origin?: unknown; forkOf?: unknown } }>("/api/simulators", async (req, reply) => {
    const user = await userOr401(req, reply);
    if (!user) return;
    const yaml = req.body?.yaml;
    if (typeof yaml !== "string") return fail(reply, 400, "invalid_body", "Champ 'yaml' manquant.");
    const result = validateSimulatorYaml(yaml);
    if (!result.valid) return reply.code(422).send({ error: "invalid_yaml", errors: result.errors });
    const sim = result.simulator as { name: string; kind: "http" | "ussd"; version: string; description?: string };
    const origin = req.body?.origin === "ai" ? "ai" : "manual";
    const forkOf = typeof req.body?.forkOf === "string" && isSlug(req.body.forkOf) ? req.body.forkOf : null;

    const outcome = await safeDbCall("publish_simulator", () =>
      db.transaction(async (tx) => {
        const [existing] = await tx.select().from(simulators).where(eq(simulators.slug, sim.name)).limit(1);
        if (existing && existing.ownerId !== user.id) return { error: "slug_taken" as const };
        let forkedFromId: string | null = null;
        if (forkOf && !existing) {
          const [parent] = await tx.select({ id: simulators.id }).from(simulators).where(eq(simulators.slug, forkOf));
          forkedFromId = parent?.id ?? null;
        }
        const id = existing?.id ?? randomUUID();
        if (!existing) {
          await tx.insert(simulators).values({
            id,
            slug: sim.name,
            ownerId: user.id,
            kind: sim.kind,
            description: sim.description ?? null,
            origin,
            status: origin === "ai" ? "to_verify" : "draft",
            forkedFromId,
            publishedAt: new Date(),
          });
        } else {
          const [dup] = await tx
            .select({ id: simulatorVersions.id })
            .from(simulatorVersions)
            .where(and(eq(simulatorVersions.simulatorId, id), eq(simulatorVersions.version, sim.version)));
          if (dup) return { error: "version_exists" as const };
          await tx.update(simulatorVersions).set({ isCurrent: false }).where(and(eq(simulatorVersions.simulatorId, id), eq(simulatorVersions.isCurrent, true)));
          await tx
            .update(simulators)
            .set({ kind: sim.kind, description: sim.description ?? null, updatedAt: new Date(), publishedAt: existing.publishedAt ?? new Date() })
            .where(eq(simulators.id, id));
        }
        await tx.insert(simulatorVersions).values({ simulatorId: id, version: sim.version, yaml, isCurrent: true, createdBy: user.id });
        return { slug: sim.name, version: sim.version };
      }),
    );
    if ("error" in outcome) {
      return outcome.error === "slug_taken"
        ? fail(reply, 409, "slug_taken", "Ce nom (name) est déjà utilisé par un autre simulateur : choisissez-en un autre.")
        : fail(reply, 409, "version_exists", "Cette version existe déjà : augmentez « version » (ex. 1.0.1).");
    }
    return reply.code(201).send(outcome);
  });

  // C6 : réception des webhooks par la boutique de démonstration (plugin encapsulé, voir demo-webhooks.ts).
  registerDemoWebhooks(app, { db, keyring: opts.keyring });
}
