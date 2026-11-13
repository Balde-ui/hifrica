// Propriétaire : Dev A
// Envoi d'une tentative de webhook (node:http / node:https, sans dépendance) et classification du résultat.
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { UnrecoverableError } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import { signWebhook } from "./signature.js";
import { checkWebhookUrl, createSafeLookup, SsrfBlockedError } from "./ssrf.js";

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
  /** URL de destination (TODO(A5) : projects.webhook_url) ; absente = rien n'est envoyé. */
  url: string | undefined;
  /** Secret de signature (TODO(A5) : secret par projet) ; absent = rien n'est envoyé. */
  secret: string | undefined;
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
  if (!deps.url) {
    deps.log.info(base, "aucune URL de webhook : rien n'est envoyé");
    return null;
  }
  if (!deps.secret) {
    deps.log.error(base, "WEBHOOK_SIGNING_SECRET absent : webhook non signé, abandon");
    throw new UnrecoverableError("signing_secret_missing");
  }

  const timestamp = Math.floor((deps.now ?? Date.now)() / 1000); // recalculé à chaque tentative
  const result = await (deps.send ?? sendWebhook)({
    url: deps.url,
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
      "X-Hifrica-Signature": signWebhook(deps.secret, timestamp, data.rawBody),
    },
  });

  // TODO(A5) : insérer une ligne par tentative dans webhook_deliveries (outcome, status_code, duration_ms...).
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
