// Propriétaire : Dev C
// Authentification des appels aux simulateurs et choix du scénario actif.
import type { FastifyRequest } from "fastify";

export type AuthResult = { ok: true; projectId: string; apiKeyId?: string } | { ok: false };

/** Vérifie la clé de test envoyée par le client et renvoie le projet associé. */
export async function authenticate(req: FastifyRequest): Promise<AuthResult> {
  // TODO(C3) vérifier la clé hachée en base.
  // TODO(C3) renvoyer l'id de la clé (apiKeyId), jamais la clé elle-même.
  // Bouchon : toute clé "Bearer sk_test_..." est acceptée et rattachée au projet "demo".
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer sk_test_")) return { ok: false };
  return { ok: true, projectId: "demo" };
}

/** Renvoie la clé du scénario à appliquer, ou undefined pour la réponse par défaut. */
export async function resolveScenario(req: FastifyRequest, projectId: string): Promise<string | undefined> {
  // TODO(C3) scénario actif du projet en base par défaut, l'en-tête reste une surcharge.
  const key = req.headers["x-hifrica-scenario"];
  return typeof key === "string" ? key : undefined;
}
