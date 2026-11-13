// Propriétaire : Dev A
// File BullMQ "webhooks" (Valkey) : programmation différée, 4 tentatives, backoff 10 s / 30 s / 90 s.
import { Queue, UnrecoverableError, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { WebhookJobData, WebhookLogger } from "./deliver.js";

export const QUEUE_NAME = "webhooks";
/** 1 envoi + 3 relances. */
export const MAX_ATTEMPTS = 4;
export const BACKOFF_DELAYS_MS = [10_000, 30_000, 90_000] as const;
const WORKER_CONCURRENCY = 5;
/** Délai maximal pour ajouter un job : au-delà, le webhook est perdu mais la requête HTTP n'attend pas. */
const ADD_TIMEOUT_MS = 1_000;
const ERROR_LOG_INTERVAL_MS = 30_000;

/** Délai avant la relance qui suit le n-ième échec (1 → 10 s, 2 → 30 s, 3 et plus → 90 s). */
export function backoffDelay(attemptsMade: number): number {
  const index = Math.min(Math.max(attemptsMade, 1), BACKOFF_DELAYS_MS.length) - 1;
  return BACKOFF_DELAYS_MS[index];
}

export interface WebhookQueue {
  add(data: WebhookJobData, delayMs: number): Promise<void>;
  close(): Promise<void>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, reason: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(reason)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Un seul log d'erreur de connexion toutes les 30 s (ioredis se reconnecte en boucle quand Valkey est arrêté). */
function throttledErrorLog(log: WebhookLogger, source: string): (err: Error) => void {
  let last = 0;
  return (err) => {
    const now = Date.now();
    if (now - last < ERROR_LOG_INTERVAL_MS) return;
    last = now;
    log.error({ source, code: (err as { code?: string }).code, reason: err.message }, "Valkey injoignable (file de webhooks)");
  };
}

export function startWebhookQueue(opts: {
  valkeyUrl: string;
  log: WebhookLogger;
  process: (data: WebhookJobData, attempt: number) => Promise<unknown>;
}): WebhookQueue {
  const { valkeyUrl, log } = opts;
  // Producteur : la file hors ligne reste active pour que l'initialisation de BullMQ attende Valkey au lieu
  // d'échouer définitivement (BullMQ garde en mémoire une initialisation ratée). Les requêtes HTTP ne sont
  // jamais bloquées pour autant : add() refuse tant que la connexion n'est pas « ready », et a un timeout.
  const producer = new Redis(valkeyUrl, { maxRetriesPerRequest: null });
  // Worker : BullMQ exige maxRetriesPerRequest: null pour les connexions bloquantes.
  const workerConnection = new Redis(valkeyUrl, { maxRetriesPerRequest: null });
  producer.on("error", throttledErrorLog(log, "producer"));
  workerConnection.on("error", throttledErrorLog(log, "worker"));

  const queue = new Queue<WebhookJobData>(QUEUE_NAME, {
    connection: producer,
    skipWaitingForReady: true,
    defaultJobOptions: {
      attempts: MAX_ATTEMPTS,
      backoff: { type: "hifrica" },
      removeOnComplete: true,
      // Les jobs abandonnés restent 24 h dans Valkey pour diagnostic (TODO(A5) : webhook_deliveries).
      removeOnFail: { age: 24 * 3600 },
    },
  });
  queue.on("error", throttledErrorLog(log, "queue"));

  const worker = new Worker<WebhookJobData>(
    QUEUE_NAME,
    // attemptsMade = nombre d'échecs précédents : la tentative en cours est attemptsMade + 1.
    async (job) => opts.process(job.data, job.attemptsMade + 1),
    {
      connection: workerConnection,
      concurrency: WORKER_CONCURRENCY,
      settings: { backoffStrategy: (attemptsMade: number) => backoffDelay(attemptsMade) },
    },
  );
  worker.on("error", throttledErrorLog(log, "worker"));
  worker.on("failed", (job, err) => {
    if (!job) return;
    const final = err instanceof UnrecoverableError || err.name === "UnrecoverableError" || job.attemptsMade >= MAX_ATTEMPTS;
    if (!final) return;
    log.error(
      {
        deliveryId: job.data.deliveryId,
        requestId: job.data.requestId,
        projectId: job.data.projectId,
        event: job.data.event,
        attempts: job.attemptsMade,
        reason: err.message,
      },
      "webhook abandonné",
    );
  });

  return {
    async add(data, delayMs) {
      if (producer.status !== "ready") throw new Error(`valkey_not_ready (${producer.status})`);
      await withTimeout(
        queue.add("deliver", data, { jobId: data.deliveryId, delay: Math.max(0, delayMs) }),
        ADD_TIMEOUT_MS,
        "valkey_timeout",
      );
    },
    async close() {
      // Le Worker termine les envois en cours (≤ 5 s chacun) avant de se fermer.
      await worker.close().catch((err: Error) => log.error({ err: { message: err.message } }, "fermeture du worker"));
      await queue.close().catch((err: Error) => log.error({ err: { message: err.message } }, "fermeture de la file"));
      producer.disconnect();
      workerConnection.disconnect();
    },
  };
}
