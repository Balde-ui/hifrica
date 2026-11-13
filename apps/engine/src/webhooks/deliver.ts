// Propriétaire : Dev A
// Envoi d'une tentative de webhook (node:http / node:https, sans dépendance) et classification du résultat.
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { UnrecoverableError } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import type { DeliveryRecord } from "./history.js";
import { signWebhook } from "./signature.js";
import { checkWebhookUrl, createSafeLookup, SsrfBlockedError } from "./ssrf.js";
import type { WebhookTarget } from "./target.js";

export type Outcome = "success" | "http_error" | "network_error" | "timeout" | "blocked";

export interface DeliveryResult {
  outcome: Outcome;
  statusCode: number | null;
  durationMs: number;
  /** Hôte de destination seul (jamais l'URL complète, qui peut contenir un jeton). */
  host: string;
}

/** Données d'un job de la file : le corps est figé à la programmation (mêmes octets à chaque tentative). */
export interface WebhookJobData {
  deliveryId: string;
  projectId: string;
  simulator: string;
  requestId: string;
  event: string;
  rawBody: string;
}

export type WebhookLogger = Pick<FastifyBaseLogger, "info" | "warn" | "error">;

export const DELIVERY_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1024;
export const USER_AGENT = "Hifrica-Webhooks/1.0";

/** Relance sur network_error, timeout, 5xx, 408 et 429 ; jamais sur blocked, 3xx ni les autres 4xx. */
export function isRetryable(outcome: Outcome, statusCode: number | null): boolean {
  if (outcome === "network_error" || outcome === "timeout") return true;
  if (outcome === "http_error" && statusCode !== null) {
    return statusCode >= 500 || statusCode === 408 || statusCode === 429;
  }
  return false;
}

export interface SendOptions {
  url: string;
  rawBody: string;
  headers: Record<string, string>;
  allowPrivate: boolean;
  timeoutMs?: number;
}

/**
 * POST unique : aucune redirection suivie (un 3xx est un échec), timeout total, corps de réponse ignoré
 * (au plus 1 Ko lu). Ne lève jamais : renvoie toujours un DeliveryResult.
 */
export function sendWebhook(opts: SendOptions): Promise<DeliveryResult> {
  const started = Date.now();
  const check = checkWebhookUrl(opts.url, opts.allowPrivate);
  if (!check.ok) {
    let host = "";
    try {
      host = new URL(opts.url).hostname;
    } catch {
      host = "";
    }
    return Promise.resolve({ outcome: "blocked", statusCode: null, durationMs: 0, host });
  }
  const { url } = check;
  const host = url.hostname;
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise<DeliveryResult>((resolve) => {
    let settled = false;
    const finish = (outcome: Outcome, statusCode: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ outcome, statusCode, durationMs: Date.now() - started, host });
    };

    const req = request(
      url,
      {
        method: "POST",
        headers: { ...opts.headers, "Content-Length": String(Buffer.byteLength(opts.rawBody)) },
        lookup: createSafeLookup(opts.allowPrivate),
        agent: false, // pas de connexion réutilisée : chaque tentative repasse par lookup
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        finish(status >= 200 && status < 300 ? "success" : "http_error", status);
        // On ne lit pas plus d'1 Ko du corps de réponse, puis on coupe.
        let read = 0;
        res.on("data", (chunk: Buffer) => {
          read += chunk.length;
          if (read >= MAX_RESPONSE_BYTES) res.destroy();
        });
        res.on("close", () => {
          clearTimeout(timer);
          req.destroy();
        });
        res.on("error", () => undefined);
      },
    );

    // Timeout total (connexion + réponse). Il reste armé après le code de statut pour couper aussi
    // une réponse dont le corps ne se termine jamais.
    const timer = setTimeout(() => {
      finish("timeout", null);
      req.destroy();
    }, opts.timeoutMs ?? DELIVERY_TIMEOUT_MS);
    timer.unref();

    req.on("error", (err) => {
      clearTimeout(timer);
      finish(err instanceof SsrfBlockedError ? "blocked" : "network_error", null);
    });
    req.end(opts.rawBody);
  });
}

export interface ProcessDeps {
  /** URL et secret du projet, lus à chaque tentative (voir target.ts). Lève si la base est injoignable. */
  resolve: (projectId: string) => Promise<WebhookTarget>;
  /** Enregistre la tentative dans webhook_deliveries (voir history.ts). Une erreur n'est jamais propagée. */
  record?: (row: DeliveryRecord) => Promise<void>;
  allowPrivate: boolean;
  log: WebhookLogger;
  send?: (opts: SendOptions) => Promise<DeliveryResult>;
  now?: () => number;
  timeoutMs?: number;
}

/**
 * Traite une tentative : signe, envoie, logue. Lève une Error pour relancer, une UnrecoverableError
 * pour abandonner sans relance (BullMQ), ou rend la main si le webhook est livré.
 */
export async function processDelivery(data: WebhookJobData, attempt: number, deps: ProcessDeps): Promise<DeliveryResult | null> {
  const base = {
    deliveryId: data.deliveryId,
    requestId: data.requestId,
    projectId: data.projectId,
    event: data.event,
    attempt,
  };
  // Historique : écrit sans attendre ; une erreur d'insertion est loguée, jamais propagée à l'envoi.
  const record = (fields: Pick<DeliveryRecord, "outcome" | "statusCode" | "durationMs" | "destinationHost">) => {
    if (!deps.record) return;
    const row: DeliveryRecord = {
      deliveryId: data.deliveryId,
      projectId: data.projectId,
      requestId: data.requestId,
      event: data.event,
      attempt,
      ...fields,
    };
    const onError = (err: unknown) =>
      deps.log.warn({ ...base, reason: err instanceof Error ? err.message : "error" }, "historique du webhook non enregistré");
    try {
      deps.record(row).catch(onError);
    } catch (err) {
      onError(err);
    }
  };

  // Destination lue maintenant : une URL ou un secret modifiés s'appliquent dès cette tentative.
  // Base injoignable : resolve lève, BullMQ relance plus tard (rien n'est envoyé ni enregistré).
  const target = await deps.resolve(data.projectId);
  if (!target.ok) {
    record({ outcome: target.outcome, statusCode: null, durationMs: 0, destinationHost: target.host });
    if (target.outcome === "no_url") {
      // Cas normal (projet sans webhook) : le job se termine, sans relance ni erreur.
      deps.log.info({ ...base, outcome: "no_url" }, "aucune URL de webhook pour ce projet : rien n'est envoyé");
      return null;
    }
    deps.log.error({ ...base, outcome: "no_secret", host: target.host }, "secret de signature indisponible : webhook non envoyé, abandon");
    throw new UnrecoverableError("no_secret");
  }

  const timestamp = Math.floor((deps.now ?? Date.now)() / 1000); // recalculé à chaque tentative
  const result = await (deps.send ?? sendWebhook)({
    url: target.url,
    rawBody: data.rawBody,
    allowPrivate: deps.allowPrivate,
    timeoutMs: deps.timeoutMs,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "X-Hifrica-Event": data.event,
      "X-Hifrica-Delivery": data.deliveryId,
      "X-Hifrica-Request-Id": data.requestId,
      "X-Hifrica-Attempt": String(attempt),
      "X-Hifrica-Signature": signWebhook(target.secret, timestamp, data.rawBody),
    },
  });

  record({
    outcome: result.outcome,
    statusCode: result.statusCode,
    durationMs: result.durationMs,
    destinationHost: result.host || null,
  });
  const entry = {
    ...base,
    outcome: result.outcome,
    statusCode: result.statusCode,
    durationMs: result.durationMs,
    host: result.host,
  };
  if (result.outcome === "success") {
    deps.log.info(entry, "webhook livré");
    return result;
  }
  const retry = isRetryable(result.outcome, result.statusCode);
  deps.log.warn({ ...entry, retry }, "tentative de webhook en échec");
  const reason = `${result.outcome}${result.statusCode !== null ? `_${result.statusCode}` : ""}`;
  throw retry ? new Error(reason) : new UnrecoverableError(reason);
}
