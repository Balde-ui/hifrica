// Propriétaire : Dev A
// Webhooks différés, signés HMAC, envoyés au serveur du client par une file BullMQ (Valkey).
//
// Variables d'environnement :
//   VALKEY_URL              connexion à Valkey ; absente = file désactivée (les webhooks sont perdus, logués)
//   WEBHOOK_TEST_URL        destination (bouchon) — TODO(A5) : lire projects.webhook_url en base
//   WEBHOOK_SIGNING_SECRET  secret HMAC (bouchon) — TODO(A5) : decryptWebhookSecret de @hifrica/db, secret par projet
//   WEBHOOK_ALLOW_PRIVATE   "true" autorise les IP privées (dev local) ; IGNORÉ si NODE_ENV=production
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { processDelivery, type WebhookJobData, type WebhookLogger } from "./deliver.js";
import { dedicatedValkey, sharedValkey } from "../valkey.js";
import { startWebhookQueue, type WebhookQueue } from "./queue.js";

export { signWebhook, verifyWebhookSignature } from "./signature.js";

export interface ScheduleWebhookOptions {
  projectId: string;
  simulator: string;
  requestId: string;
  event: string;
  body: unknown;
  delayMs: number;
}

interface WebhookConfig {
  valkeyUrl: string | undefined;
  allowPrivate: boolean;
}

type Env = Record<string, string | undefined>;

let config: WebhookConfig = { valkeyUrl: undefined, allowPrivate: false };
let queue: WebhookQueue | null = null;

/** Destination du webhook d'un projet. TODO(A5) : lire projects.webhook_url en base. */
function resolveWebhookUrl(_projectId: string, env: Env = process.env): string | undefined {
  return env.WEBHOOK_TEST_URL || undefined;
}

/** Secret de signature d'un projet. TODO(A5) : decryptWebhookSecret de @hifrica/db, secret par projet. */
function resolveSigningSecret(_projectId: string, env: Env = process.env): string | undefined {
  return env.WEBHOOK_SIGNING_SECRET || undefined;
}

export function readWebhookConfig(env: Env, log: WebhookLogger): WebhookConfig {
  const wantsPrivate = env.WEBHOOK_ALLOW_PRIVATE === "true";
  const production = env.NODE_ENV === "production";
  if (wantsPrivate && production) {
    log.warn("WEBHOOK_ALLOW_PRIVATE=true ignoré : NODE_ENV=production, les IP privées restent bloquées");
  } else if (wantsPrivate) {
    log.warn("WEBHOOK_ALLOW_PRIVATE=true : webhooks autorisés vers les IP privées (développement uniquement)");
  }
  if (env.WEBHOOK_SIGNING_SECRET === "change-moi") {
    log.warn("WEBHOOK_SIGNING_SECRET vaut encore la valeur d'exemple « change-moi »");
  }
  return { valkeyUrl: env.VALKEY_URL || undefined, allowPrivate: wantsPrivate && !production };
}

/**
 * Démarre la file et le Worker dans le process du moteur, et les ferme à l'arrêt de Fastify.
 * Les connexions viennent de valkey.ts (registerValkey doit être appelé avant).
 */
export function registerWebhooks(app: FastifyInstance, env: Env = process.env): void {
  config = readWebhookConfig(env, app.log);
  const producer = sharedValkey();
  const workerConnection = dedicatedValkey("webhooks-worker");
  if (!config.valkeyUrl || !producer || !workerConnection) {
    app.log.warn("VALKEY_URL absente : file de webhooks désactivée, aucun webhook ne sera envoyé");
    return;
  }
  const log = app.log.child({ component: "webhooks" });
  queue = startWebhookQueue({
    producer,
    workerConnection,
    log,
    process: (data, attempt) =>
      processDelivery(data, attempt, {
        url: resolveWebhookUrl(data.projectId, env),
        secret: resolveSigningSecret(data.projectId, env),
        allowPrivate: config.allowPrivate,
        log,
      }),
  });
  app.addHook("onClose", async () => {
    await queue?.close();
    queue = null;
  });
}

/**
 * Programme l'envoi d'un webhook après `delayMs`. Ne lève jamais et ne bloque pas la requête HTTP :
 * si Valkey est injoignable, l'erreur est loguée et le webhook est perdu.
 * Appelée par la route du moteur (webhook sans "on") et par A4 (phone.confirm).
 */
export async function scheduleWebhook(
  opts: ScheduleWebhookOptions,
  log: Pick<WebhookLogger, "info" | "error"> = console,
): Promise<void> {
  const base = { requestId: opts.requestId, projectId: opts.projectId, event: opts.event };
  if (!resolveWebhookUrl(opts.projectId)) {
    log.info(base, "aucune URL de webhook : rien n'est envoyé");
    return;
  }
  if (!resolveSigningSecret(opts.projectId)) {
    log.error(base, "WEBHOOK_SIGNING_SECRET absent : webhook non programmé");
    return;
  }
  if (!queue) {
    log.error(base, "file de webhooks indisponible (VALKEY_URL absente) : webhook perdu");
    return;
  }

  const deliveryId = randomUUID();
  // Corps figé ici : les mêmes octets sont envoyés (et signés) à chaque tentative.
  const rawBody = JSON.stringify({ id: deliveryId, event: opts.event, created_at: new Date().toISOString(), data: opts.body });
  const data: WebhookJobData = {
    deliveryId,
    projectId: opts.projectId,
    simulator: opts.simulator,
    requestId: opts.requestId,
    event: opts.event,
    rawBody,
  };
  try {
    await queue.add(data, opts.delayMs);
    log.info({ ...base, deliveryId, delayMs: opts.delayMs }, "webhook programmé");
  } catch (err) {
    log.error({ ...base, deliveryId, reason: err instanceof Error ? err.message : "error" }, "Valkey injoignable : webhook perdu");
  }
}
