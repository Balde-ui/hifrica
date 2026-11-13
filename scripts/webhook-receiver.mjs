#!/usr/bin/env node
// Récepteur de webhooks pour le DÉVELOPPEMENT uniquement (aucune dépendance).
// Affiche les en-têtes reçus et vérifie X-Hifrica-Signature avec WEBHOOK_SIGNING_SECRET,
// indépendamment du code du moteur (comme le ferait un client).
//
//   WEBHOOK_SIGNING_SECRET=test node scripts/webhook-receiver.mjs      # écoute sur le port 4999
//   RECEIVER_PORT=5000 RECEIVER_STATUS=500 ...                          # autre port / autre code de réponse
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.RECEIVER_PORT ?? 4999);
const status = Number(process.env.RECEIVER_STATUS ?? 200);
const secret = process.env.WEBHOOK_SIGNING_SECRET;
const TOLERANCE_SEC = 300;

if (!secret) console.warn("WEBHOOK_SIGNING_SECRET absent : la signature ne sera pas vérifiée.");

function verify(header, rawBody) {
  if (!secret) return "non vérifiée (pas de secret)";
  const fields = Object.fromEntries(String(header ?? "").split(",").map((p) => p.trim().split("=", 2)));
  const t = Number(fields.t);
  if (!Number.isInteger(t) || !fields.v1) return "INVALIDE (en-tête mal formé)";
  const age = Math.floor(Date.now() / 1000) - t;
  if (Math.abs(age) > TOLERANCE_SEC) return `INVALIDE (horodatage hors tolérance : ${age} s)`;
  const expected = createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest();
  const received = Buffer.from(fields.v1, "hex");
  const ok = received.length === expected.length && timingSafeEqual(received, expected);
  return ok ? `VALIDE (âge ${age} s)` : "INVALIDE (signature différente)";
}

createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const rawBody = Buffer.concat(chunks);
    console.log(`\n=== ${new Date().toISOString()}  ${req.method} ${req.url}`);
    for (const [name, value] of Object.entries(req.headers)) console.log(`${name}: ${value}`);
    console.log(`corps (${rawBody.length} octets) : ${rawBody.toString("utf8")}`);
    console.log(`signature : ${verify(req.headers["x-hifrica-signature"], rawBody)}`);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ received: true }));
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Récepteur de webhooks sur http://localhost:${port} (réponse ${status})`);
});
