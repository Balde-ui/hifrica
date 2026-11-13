// Session de paiement sur le téléphone simulé, stockée dans Valkey (clé phoneSessionKey, TTL 10 min).
// Contrat A3/A4/B1 :
//   - le moteur (A3) écrit la session quand il publie payment.pending (status "pending") ;
//   - l'API (B1) la relit, passe status à "confirmed" ou "rejected", puis publie phone.confirm / phone.reject ;
//   - le moteur (A4) relit la session à la réception de l'événement et programme le webhook.

/** Durée de vie d'une session de paiement : au-delà, la confirmation est ignorée. */
export const PHONE_SESSION_TTL_SEC = 600;

/** Clé Valkey d'une session de paiement. */
export function phoneSessionKey(sessionId: string): string {
  return "phone-session:" + sessionId;
}

export type PhoneSessionStatus = "pending" | "confirmed" | "rejected";

export interface PhoneSession {
  /** Identifiant du checkout renvoyé dans la réponse HTTP (= sessionId de payment.pending). */
  sessionId: string;
  projectId: string;
  simulator: string;
  endpointId: string;
  /** X-Hifrica-Request-Id de la requête d'origine. */
  requestId?: string;
  status: PhoneSessionStatus;
  createdAt: string;
  /** Contexte de rendu de la requête d'origine, pour le corps du webhook. */
  ctx: {
    body: Record<string, unknown>;
    query: Record<string, unknown>;
    params: Record<string, string>;
  };
  /** Réponse renvoyée au client (corps déjà rendu), pour {{response.x}} dans le webhook. */
  response: { status: number; body: unknown };
}

const STATUSES: readonly string[] = ["pending", "confirmed", "rejected"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwnFields(obj: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => Object.hasOwn(obj, field) && obj[field] !== undefined && obj[field] !== null);
}

/** Vérifie à l'exécution qu'une valeur (ex. relue dans Valkey) est une session de paiement valide. */
export function isPhoneSession(value: unknown): value is PhoneSession {
  if (!isPlainObject(value)) return false;
  if (!hasOwnFields(value, ["sessionId", "projectId", "simulator", "endpointId", "status", "createdAt", "ctx", "response"])) {
    return false;
  }
  const { sessionId, projectId, simulator, endpointId, requestId, status, createdAt, ctx, response } = value;
  if (typeof sessionId !== "string" || sessionId === "") return false;
  if (typeof projectId !== "string" || projectId === "") return false;
  if (typeof simulator !== "string" || simulator === "") return false;
  if (typeof endpointId !== "string" || endpointId === "") return false;
  if (Object.hasOwn(value, "requestId") && typeof requestId !== "string") return false;
  if (typeof status !== "string" || !STATUSES.includes(status)) return false;
  if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))) return false;

  if (!isPlainObject(ctx) || !hasOwnFields(ctx, ["body", "query", "params"])) return false;
  if (!isPlainObject(ctx.body) || !isPlainObject(ctx.query) || !isPlainObject(ctx.params)) return false;
  if (!Object.values(ctx.params).every((v) => typeof v === "string")) return false;

  if (!isPlainObject(response) || !Object.hasOwn(response, "status") || !Object.hasOwn(response, "body")) return false;
  const code = response.status;
  return typeof code === "number" && Number.isInteger(code) && code >= 100 && code <= 599;
}
