// Propriétaire : Dev C (C4)
// Journalisation des requêtes reçues par le moteur : journal applicatif + table request_logs (console).
// Ne jamais journaliser l'en-tête Authorization, la query ni les corps de requête/réponse : request_logs
// ne reçoit que des métadonnées (règle « corps HTTP non enregistrés par défaut »).
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isUuid, requestLogs, safeDbCall, simulators } from "@hifrica/db";
import { eq } from "drizzle-orm";
import "./context.js"; // déclare request.hifrica
import { getDb } from "./db.js";

const SECRET_PATTERN = /sk_(?:test|live)_[0-9A-Za-z]+|whsec_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g;

/** Chemin sans chaîne de requête, secrets masqués, 2048 caractères au plus (contrainte de la table). */
function safePath(url: string): string {
  return url.split("?")[0].replace(SECRET_PATTERN, "[masqué]").slice(0, 2048);
}

const simulatorIds = new Map<string, string | null>();

async function simulatorId(slug: string): Promise<string | null> {
  if (simulatorIds.has(slug)) return simulatorIds.get(slug) ?? null;
  const db = getDb();
  if (!db) return null;
  const [row] = await safeDbCall("insert_request_log", () =>
    db.select({ id: simulators.id }).from(simulators).where(eq(simulators.slug, slug)).limit(1),
  );
  // Un simulateur absent de la base n'est pas mis en cache : il peut être importé plus tard.
  if (row) simulatorIds.set(slug, row.id);
  return row?.id ?? null;
}

function persist(request: FastifyRequest, reply: FastifyReply | null, outcome: "responded" | "client_aborted"): void {
  const ctx = request.hifrica;
  const db = getDb();
  // Seules les requêtes authentifiées d'un vrai projet (uuid) vont en base : pas /health, pas le bouchon local.
  if (!db || !ctx?.projectId || !isUuid(ctx.projectId) || !isUuid(request.id)) return;
  const headers = request.headers;
  const insert = async () => {
    const simId = await simulatorId(ctx.simulator);
    await safeDbCall("insert_request_log", () =>
      db
        .insert(requestLogs)
        .values({
          requestId: request.id,
          projectId: ctx.projectId!,
          apiKeyId: ctx.apiKeyId ?? null,
          simulatorId: simId,
          simulatorSlug: ctx.simulator,
          channel: ctx.channel,
          source: "api",
          outcome,
          endpointId: ctx.endpointId ?? null,
          scenarioKey: ctx.scenarioKey ?? null,
          method: request.method.slice(0, 10),
          path: safePath(request.url),
          status: outcome === "responded" && reply ? reply.statusCode : null,
          durationMs: Math.max(0, Math.round(reply?.elapsedTime ?? 0)),
          request: {
            contentType: typeof headers["content-type"] === "string" ? headers["content-type"].slice(0, 100) : null,
            contentLength: typeof headers["content-length"] === "string" ? Number(headers["content-length"]) || 0 : 0,
          },
          response: outcome === "responded" && reply ? { contentType: String(reply.getHeader("content-type") ?? "").slice(0, 100) || null } : null,
        })
        .onConflictDoNothing({ target: requestLogs.requestId }),
    );
  };
  insert().catch((err: unknown) => request.log.warn({ err }, "journal de requête non enregistré"));
}

/** Enregistre les crochets de journalisation. À appeler avant la déclaration des routes. */
export function registerRequestLogging(app: FastifyInstance): void {
  app.addHook("onResponse", async (request, reply) => {
    const ctx = request.hifrica; // null pour /health ou un simulateur inconnu
    app.log.info(
      {
        requestId: request.id,
        simulator: ctx?.simulator,
        channel: ctx?.channel,
        projectId: ctx?.projectId,
        apiKeyId: ctx?.apiKeyId,
        endpointId: ctx?.endpointId,
        scenarioKey: ctx?.scenarioKey,
        method: request.method,
        path: safePath(request.url),
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      "requête traitée",
    );
    persist(request, reply, "responded");
  });
  // Client parti avant la réponse : status NULL (aucun code inventé).
  app.addHook("onRequestAbort", async (request) => {
    persist(request, null, "client_aborted");
  });
}
