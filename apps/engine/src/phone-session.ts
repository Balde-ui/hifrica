// Propriétaire : Dev A
// Sessions de paiement (A3) : écrites dans Valkey quand payment.pending est publié, relues par A4 (et B1).
import {
  PHONE_SESSION_TTL_SEC,
  phoneSessionKey,
  type PaymentPendingEvent,
  type PhoneSession,
} from "@hifrica/shared";
import type { FastifyBaseLogger } from "fastify";
import { publishEvent } from "./events.js";
import type { RenderedResponse } from "./response.js";
import type { TemplateContext } from "./template.js";
import type { Redis } from "ioredis";
import { runCommand, sharedValkey } from "./valkey.js";

/** Accès aux sessions ; implémenté sur Valkey, remplaçable dans les tests. */
export interface SessionStore {
  /** SET … EX TTL NX : false si la clé existait déjà. Lève si Valkey est injoignable. */
  create(session: PhoneSession): Promise<boolean>;
  /** Valeur brute relue (JSON décodé), ou null si absente ou expirée. Lève si Valkey est injoignable. */
  get(sessionId: string): Promise<unknown>;
  /** SET phone-session:{id}:fired 1 EX TTL NX : true au premier appel seulement (dédoublonnage). */
  markFired(sessionId: string): Promise<boolean>;
}

export function firedKey(sessionId: string): string {
  return `${phoneSessionKey(sessionId)}:fired`;
}

/** Store sur Valkey (client partagé par défaut). Chaque commande échoue vite si Valkey n'est pas prêt. */
export function createValkeySessionStore(client: () => Redis | null = sharedValkey): SessionStore {
  return {
    async create(session) {
      const ok = await runCommand(
        (c) => c.set(phoneSessionKey(session.sessionId), JSON.stringify(session), "EX", PHONE_SESSION_TTL_SEC, "NX"),
        client(),
      );
      return ok === "OK";
    },
    async get(sessionId) {
      const raw = await runCommand((c) => c.get(phoneSessionKey(sessionId)), client());
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    },
    async markFired(sessionId) {
      const ok = await runCommand((c) => c.set(firedKey(sessionId), "1", "EX", PHONE_SESSION_TTL_SEC, "NX"), client());
      return ok === "OK";
    },
  };
}

export const valkeySessionStore: SessionStore = createValkeySessionStore();

/** Session « pending » correspondant à un payment.pending (sessionId = id du checkout renvoyé). */
export function buildPhoneSession(event: PaymentPendingEvent, ctx: TemplateContext, response: RenderedResponse): PhoneSession {
  return {
    sessionId: event.sessionId,
    projectId: event.projectId,
    simulator: event.simulator,
    endpointId: event.endpointId,
    ...(event.requestId !== undefined ? { requestId: event.requestId } : {}),
    status: "pending",
    createdAt: event.createdAt,
    ctx: { body: ctx.body, query: ctx.query, params: ctx.params },
    response: { status: response.status, body: response.body },
  };
}

export type SessionResult = { ok: true } | { ok: false; reason: string };

/**
 * Écrit la session AVANT toute publication de payment.pending. Ne lève jamais : en cas d'échec
 * (Valkey injoignable, clé déjà existante), l'appelant répond quand même mais ne publie pas l'événement.
 */
export async function savePhoneSession(session: PhoneSession, store: SessionStore = valkeySessionStore): Promise<SessionResult> {
  try {
    return (await store.create(session)) ? { ok: true } : { ok: false, reason: "session_exists" };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "error" };
  }
}

export interface StartPaymentSessionOptions {
  event: PaymentPendingEvent;
  ctx: TemplateContext;
  response: RenderedResponse;
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  store?: SessionStore;
  /** Publication de l'événement : publishEvent (events.ts, Dev B) par défaut. */
  publish?: (event: PaymentPendingEvent, log: Pick<FastifyBaseLogger, "info">) => Promise<void>;
}

/**
 * A3 : écrit D'ABORD la session, PUIS publie payment.pending. Si la session n'a pas pu être écrite,
 * l'événement n'est pas publié (le téléphone ne doit pas afficher un paiement que A4 ne saurait pas
 * confirmer). Ne lève jamais : la réponse HTTP part dans tous les cas.
 */
export async function startPaymentSession(opts: StartPaymentSessionOptions): Promise<SessionResult> {
  const { event, ctx, response, log } = opts;
  const saved = await savePhoneSession(buildPhoneSession(event, ctx, response), opts.store);
  if (!saved.ok) {
    log.warn(
      { sessionId: event.sessionId, requestId: event.requestId, reason: saved.reason },
      "session de paiement non écrite (Valkey) : payment.pending non publié",
    );
    return saved;
  }
  await (opts.publish ?? publishEvent)(event, log).catch((err: unknown) => log.error({ err }, "publishEvent a échoué"));
  return saved;
}
