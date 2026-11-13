// Propriétaire : Dev A
// Webhooks différés, signés HMAC, envoyés au serveur du client par une file BullMQ (Valkey).
//
// Destination et secret : ceux du PROJET (projects.webhook_url, secret chiffré), lus au moment de l'envoi
// (target.ts). Chaque tentative est enregistrée dans webhook_deliveries (history.ts).
//
// Variables d'environnement :
//   VALKEY_URL              connexion à Valkey ; absente = file désactivée (les webhooks sont perdus, logués)
//   DATABASE_URL            base des projets (via ../db.ts) ; absente = mode développement à bouchons
//   WEBHOOK_SECRET_KEYS     clés de déchiffrement des secrets de projet (lues une fois au démarrage)
//   WEBHOOK_TEST_URL        bouchon : destination, SEULEMENT sans base et hors production
//   WEBHOOK_SIGNING_SECRET  bouchon : secret HMAC, SEULEMENT sans base et hors production
//   WEBHOOK_ALLOW_PRIVATE   "true" autorise les IP privées (dev local) ; IGNORÉ si NODE_ENV=production
import { randomUUID } from "node:crypto";
import { parseWebhookSecretKeyring, type WebhookSecretKeyring } from "@hifrica/db";
import type { FastifyInstance } from "fastify";
import { getDb } from "../db.js";
import { processDelivery, type WebhookJobData, type WebhookLogger } from "./deliver.js";
import { createDeliveryRecorder } from "./history.js";
import { dedicatedValkey, sharedValkey } from "../valkey.js";
import { startWebhookQueue, type WebhookQueue } from "./queue.js";
import { createTargetResolver } from "./target.js";

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

/**
 * Clés de déchiffrement des secrets de projet, lues une fois au démarrage. Absentes ou invalides : null, et
 * chaque envoi d'un projet en base aboutit à « no_secret » (sans relance).
 */
export function loadKeyring(env: Env, log: WebhookLogger, hasDb: boolean): WebhookSecretKeyring | null {
  if (!hasDb) return null;
  const production = env.NODE_ENV === "production";
  try {
    return parseWebhookSecretKeyring(env.WEBHOOK_SECRET_KEYS);
  } catch (err) {
    // Message sans valeur de clé (WebhookSecretError).
    const msg = `WEBHOOK_SECRET_KEYS absente ou invalide (${err instanceof Error ? err.message : "erreur"}) : aucun webhook de projet ne sera signé ni envoyé`;
    if (production) log.error(msg);
    else log.warn(msg);
    return null;
  }
}

export function readWebhookConfig(env: Env, log: WebhookLogger): WebhookConfig {
  const wantsPrivate = env.WEBHOOK_ALLOW_PRIVATE === "true";
  const production = env.NODE_ENV === "production";
  if (wantsPrivate && production) {
    log.warn("WEBHOOK_ALLOW_PRIVATE=true ignoré : NODE_ENV=production, les IP privées restent bloquées");
  } else if (wantsPrivate) {
    log.warn("WEBHOOK_ALLOW_PRIVATE=true : webhooks autorisés vers les IP privées (développement uniquement)");
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
  const hasDb = getDb() !== null;
  const production = env.NODE_ENV === "production";
  if (hasDb && (env.WEBHOOK_TEST_URL || env.WEBHOOK_SIGNING_SECRET)) {
    log.warn("WEBHOOK_TEST_URL / WEBHOOK_SIGNING_SECRET ignorées : la base est configurée, l'URL et le secret de chaque projet sont utilisés");
  }
  if (!hasDb && production) {
    log.error("DATABASE_URL absente en production : aucun webhook ne sera envoyé (bouchons interdits en production)");
  } else if (!hasDb) {
    log.warn("DATABASE_URL absente : webhooks en mode développement (WEBHOOK_TEST_URL et WEBHOOK_SIGNING_SECRET)");
    if (env.WEBHOOK_SIGNING_SECRET === "change-moi") log.warn("WEBHOOK_SIGNING_SECRET vaut encore la valeur d'exemple « change-moi »");
  }
  const resolve = createTargetResolver({ getDb, keyring: loadKeyring(env, log, hasDb), env, log });
  const record = createDeliveryRecorder(getDb);
  queue = startWebhookQueue({
    producer,
    workerConnection,
    log,
    process: (data, attempt) => processDelivery(data, attempt, { resolve, record, allowPrivate: config.allowPrivate, log }),
  });
  app.addHook("onClose", async () => {
    await queue?.close();
    queue = null;
  });
}

/**
 * Programme l'envoi d'un webhook après `delayMs`. Ne lève jamais et ne bloque pas la requête HTTP :
 * si Valkey est injoignable, l'erreur est loguée et le webhook est perdu.
 * L'URL et le secret ne sont PAS lus ici mais au moment de l'envoi (le Worker enregistre « no_url » s'il
 * n'y en a pas) : une URL ajoutée dans « Paramètres » avant l'envoi est donc prise en compte.
 * Appelée par la route du moteur (webhook sans "on") et par A4 (phone.confirm).
 */
export async function scheduleWebhook(
  opts: ScheduleWebhookOptions,
  log: Pick<WebhookLogger, "info" | "error"> = console,
): Promise<void> {
  const base = { requestId: opts.requestId, projectId: opts.projectId, event: opts.event };
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
