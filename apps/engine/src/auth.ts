// Propriétaire : Dev C (C3)
// Authentification des appels aux simulateurs et choix du scénario actif.
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { apiKeys, hashApiKey, isUuid, projectSimulators, safeDbCall, simulators } from "@hifrica/db";
import { getDb } from "./db.js";

export type AuthResult = { ok: true; projectId: string; apiKeyId?: string } | { ok: false };

const KEY_HEADER = /^Bearer (sk_test_[0-9A-Za-z]{43})$/;
/** last_used_at n'est mis à jour qu'une fois par minute et par clé (écriture rare, horloge de la base). */
const TOUCH_INTERVAL_SECONDS = 60;

/**
 * Vérifie la clé de test (empreinte SHA-256, clé non révoquée) et renvoie le projet associé.
 * Sans base (développement local uniquement), l'ancien bouchon reste disponible : projet "demo".
 */
export async function authenticate(req: FastifyRequest): Promise<AuthResult> {
  const header = req.headers.authorization ?? "";
  const db = getDb();
  if (!db) {
    if (process.env.NODE_ENV === "production") return { ok: false };
    return header.startsWith("Bearer sk_test_") ? { ok: true, projectId: "demo" } : { ok: false };
  }
  const match = KEY_HEADER.exec(header);
  if (!match) return { ok: false }; // format invalide : aucune requête SQL
  const [row] = await safeDbCall("resolve_api_key", () =>
    db
      .select({ id: apiKeys.id, projectId: apiKeys.projectId })
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, hashApiKey(match[1])), isNull(apiKeys.revokedAt)))
      .limit(1),
  );
  if (!row) return { ok: false };
  // Mise à jour de last_used_at sans attendre ; une erreur ici ne doit jamais bloquer l'appel.
  safeDbCall("touch_api_key", () =>
    db
      .update(apiKeys)
      .set({ lastUsedAt: sql`now()` })
      .where(
        and(
          eq(apiKeys.id, row.id),
          or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, sql`now() - make_interval(secs => ${TOUCH_INTERVAL_SECONDS})`)),
        ),
      ),
  ).catch((err: unknown) => req.log.warn({ err }, "mise à jour de last_used_at impossible"));
  return { ok: true, projectId: row.projectId, apiKeyId: row.id };
}

/**
 * Scénario à appliquer : l'en-tête X-Hifrica-Scenario (surcharge ponctuelle, A-6) l'emporte, puis le
 * scénario actif du projet en base, sinon undefined (réponse nominale).
 */
export async function resolveScenario(req: FastifyRequest, projectId: string): Promise<string | undefined> {
  const key = req.headers["x-hifrica-scenario"];
  if (typeof key === "string" && key !== "") return key;
  const db = getDb();
  const slug = req.hifrica?.simulator;
  if (!db || !isUuid(projectId) || !slug) return undefined;
  const [row] = await safeDbCall("get_active_scenario", () =>
    db
      .select({ key: projectSimulators.activeScenarioKey })
      .from(projectSimulators)
      .innerJoin(simulators, eq(simulators.id, projectSimulators.simulatorId))
      .where(and(eq(projectSimulators.projectId, projectId), eq(simulators.slug, slug)))
      .limit(1),
  );
  return row?.key ?? undefined;
}
