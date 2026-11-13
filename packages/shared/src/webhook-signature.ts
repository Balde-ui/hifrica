// Propriétaire : Dev A
// Signature HMAC-SHA256 des webhooks Hifrica, partagée par le moteur (envoi) et l'API (réception, C6).
//
// Module SERVEUR uniquement (node:crypto) : importé par "@hifrica/shared/webhook-signature", jamais exporté
// par index.ts, que le navigateur charge (apps/web).
//
// En-tête : X-Hifrica-Signature: t=<timestamp unix en secondes>,v1=<hex>
// avec v1 = HMAC-SHA256(secret, `${t}.${corpsBrut}`), corpsBrut étant les octets exacts du corps reçu.
// Côté client : recalculer v1, comparer en temps constant, refuser si |maintenant - t| > tolérance.
import { createHmac, timingSafeEqual } from "node:crypto";

function hmacHex(secret: string, timestamp: number, rawBody: string | Buffer): string {
  return createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
}

/** Valeur de l'en-tête X-Hifrica-Signature : "t=<timestamp>,v1=<hex>". */
export function signWebhook(secret: string, timestamp: number, rawBody: string | Buffer): string {
  return `t=${timestamp},v1=${hmacHex(secret, timestamp, rawBody)}`;
}

/**
 * Vérifie un en-tête X-Hifrica-Signature. Refuse un horodatage hors tolérance (rejeu) ou une signature
 * différente. Plusieurs v1 sont acceptés (rotation de secret). Comparaison en temps constant.
 */
export function verifyWebhookSignature(
  secret: string,
  header: string | undefined | null,
  rawBody: string | Buffer,
  toleranceSec = 300,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t" && /^\d+$/.test(value ?? "")) timestamp = Number(value);
    else if (key === "v1" && /^[0-9a-f]{64}$/i.test(value ?? "")) signatures.push(value.toLowerCase());
  }
  if (timestamp === undefined || signatures.length === 0) return false;
  if (Math.abs(nowSec - timestamp) > toleranceSec) return false;

  const expected = Buffer.from(hmacHex(secret, timestamp, rawBody), "hex");
  let valid = false;
  for (const sig of signatures) {
    const candidate = Buffer.from(sig, "hex");
    // Pas de sortie anticipée : toutes les signatures sont comparées.
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) valid = true;
  }
  return valid;
}
