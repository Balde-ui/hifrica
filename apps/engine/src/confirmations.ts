// Propriétaire : Dev A
// A4 : webhooks déclenchés par la réponse du téléphone simulé.
// Le moteur s'abonne (PSUBSCRIBE) aux canaux project:*:events. Sur phone.confirm / phone.reject publié
// par l'API (B1), il relit la session de paiement (A3) et programme le webhook « on: <type> » du YAML.
// Jamais de crash si Valkey tombe : ioredis se reconnecte et se réabonne seul.
import { isHifricaEvent, isPhoneSession, projectChannel, type HifricaEvent } from "@hifrica/shared";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { isEngineUnavailable, toResolver, type SimulatorSource } from "./catalog.js";
import { valkeySessionStore, type SessionStore } from "./phone-session.js";
import type { Simulator } from "./simulators.js";
import { parseDelay, render } from "./template.js";
import { dedicatedValkey } from "./valkey.js";
import { scheduleWebhook, type ScheduleWebhookOptions } from "./webhooks.js";

export const EVENTS_PATTERN = "project:*:events";

type ConfirmationLogger = Pick<FastifyBaseLogger, "info" | "warn" | "error">;
type PhoneEvent = Extract<HifricaEvent, { type: "phone.confirm" | "phone.reject" }>;

export type ConfirmationOutcome =
  | "scheduled"
  | "ignored" // autre type d'événement (payment.pending, ussd.*...) : rien à faire ici
  | "invalid_event"
  | "channel_mismatch"
  | "valkey_error"
  | "session_missing"
  | "project_mismatch"
  | "status_mismatch"
  | "duplicate"
  | "engine_unavailable" // simulateur publié illisible (base injoignable) : session non marquée
  | "endpoint_missing"
  | "no_webhook";

export interface ConfirmationDeps {
  /** Fichiers de simulators/ (Map) ou résolveur du catalogue (fichiers puis simulateurs publiés). */
  simulators: SimulatorSource;
  store?: SessionStore;
  schedule?: (opts: ScheduleWebhookOptions, log: ConfirmationLogger) => Promise<void>;
  log: ConfirmationLogger;
}

const EXPECTED_STATUS = { "phone.confirm": "confirmed", "phone.reject": "rejected" } as const;

function isPhoneEvent(event: HifricaEvent): event is PhoneEvent {
  return event.type === "phone.confirm" || event.type === "phone.reject";
}

/** Traite un message reçu sur un canal project:<id>:events. Ne lève jamais. */
export async function handleConfirmationMessage(channel: string, message: string, deps: ConfirmationDeps): Promise<ConfirmationOutcome> {
  const { simulators, log } = deps;
  const store = deps.store ?? valkeySessionStore;

  let data: unknown;
  try {
    data = JSON.parse(message);
  } catch {
    log.warn({ channel }, "confirmation : message illisible ignoré");
    return "invalid_event";
  }
  if (!isHifricaEvent(data)) {
    log.warn({ channel }, "confirmation : événement invalide ignoré");
    return "invalid_event";
  }
  if (!isPhoneEvent(data)) return "ignored";
  const event = data;
  // Jamais le contenu de la session ni du corps dans les logs : seulement des identifiants.
  const base = { type: event.type, sessionId: event.sessionId, projectId: event.projectId, requestId: event.requestId };

  if (channel !== projectChannel(event.projectId)) {
    log.warn({ ...base, channel }, "confirmation : projet de l'événement différent de celui du canal, ignorée");
    return "channel_mismatch";
  }

  let raw: unknown;
  try {
    raw = await store.get(event.sessionId);
  } catch (err) {
    log.warn({ ...base, reason: err instanceof Error ? err.message : "error" }, "confirmation : Valkey injoignable, ignorée");
    return "valkey_error";
  }
  if (!isPhoneSession(raw)) {
    log.info(base, "confirmation : session absente ou expirée, ignorée");
    return "session_missing";
  }
  const session = raw;
  if (session.projectId !== event.projectId) {
    log.warn(base, "confirmation : la session appartient à un autre projet, ignorée");
    return "project_mismatch";
  }
  // Contrat B1 : la session passe à confirmed / rejected AVANT la publication de l'événement.
  if (session.status !== EXPECTED_STATUS[event.type]) {
    log.warn({ ...base, status: session.status }, "confirmation : statut de session incohérent avec l'événement, ignorée");
    return "status_mismatch";
  }

  // Simulateur résolu AVANT le dédoublonnage : si la base est injoignable, la session n'est pas marquée
  // et une nouvelle publication de l'événement pourra encore déclencher le webhook. La session garde le
  // slug ; si la version publiée a changé entre-temps, c'est la version courante qui est utilisée.
  let sim: Simulator | null;
  try {
    sim = await toResolver(simulators)(session.simulator);
  } catch (err) {
    const reason = isEngineUnavailable(err) ? err.reason : "error";
    log.warn({ ...base, simulator: session.simulator, reason }, "confirmation : simulateur indisponible (base injoignable), ignorée");
    return "engine_unavailable";
  }

  // Dédoublonnage : une session ne déclenche qu'un webhook, même si l'événement est republié.
  let first: boolean;
  try {
    first = await store.markFired(session.sessionId);
  } catch (err) {
    log.warn({ ...base, reason: err instanceof Error ? err.message : "error" }, "confirmation : Valkey injoignable, ignorée");
    return "valkey_error";
  }
  if (!first) {
    log.info(base, "confirmation déjà traitée pour cette session, ignorée");
    return "duplicate";
  }

  const endpoint = sim?.endpoints?.find((e) => e.id === session.endpointId);
  if (!endpoint) {
    log.warn({ ...base, simulator: session.simulator, endpointId: session.endpointId }, "confirmation : endpoint introuvable");
    return "endpoint_missing";
  }
  const webhook = endpoint.webhook;
  if (!webhook || webhook.on !== event.type) {
    log.info({ ...base, endpointId: endpoint.id }, `aucun webhook « on: ${event.type} » pour cet endpoint : rien n'est envoyé`);
    return "no_webhook";
  }

  await (deps.schedule ?? scheduleWebhook)(
    {
      projectId: session.projectId,
      simulator: session.simulator,
      requestId: session.requestId ?? event.requestId ?? "",
      event: webhook.event,
      body: render(webhook.body ?? {}, { ...session.ctx, response: session.response.body }),
      delayMs: parseDelay(webhook.after),
    },
    log,
  );
  return "scheduled";
}

/** Abonnement PSUBSCRIBE au démarrage (client dédié), fermé à l'arrêt de Fastify. */
export function registerConfirmations(
  app: FastifyInstance,
  simulators: SimulatorSource,
  overrides: Pick<ConfirmationDeps, "store" | "schedule"> = {},
): void {
  const subscriber = dedicatedValkey("confirmations");
  if (!subscriber) {
    app.log.warn("VALKEY_URL absente : confirmations du téléphone non écoutées");
    return;
  }
  const log = app.log.child({ component: "confirmations" });
  subscriber.on("pmessage", (_pattern: string, channel: string, message: string) => {
    handleConfirmationMessage(channel, message, { simulators, log, ...overrides }).catch((err: unknown) =>
      log.error({ reason: err instanceof Error ? err.message : "error" }, "confirmation : erreur inattendue"),
    );
  });
  // Commande mise en file si Valkey n'est pas encore prêt ; ioredis se réabonne après chaque reconnexion.
  subscriber.psubscribe(EVENTS_PATTERN).then(
    () => log.info({ pattern: EVENTS_PATTERN }, "abonné aux événements des projets"),
    (err: Error) => log.error({ reason: err.message }, "abonnement aux événements impossible"),
  );
  app.addHook("onClose", async () => {
    subscriber.disconnect();
  });
}
