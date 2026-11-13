import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { signWebhook, verifyWebhookSignature } from "./signature.js";

const SECRET = "whsec_test_secret";
const BODY = '{"id":"d1","event":"checkout.completed","created_at":"2026-11-12T10:00:00.000Z","data":{"status":"succeeded"}}';
const T = 1_794_000_000;

describe("signature des webhooks", () => {
  it("signWebhook produit t=<timestamp>,v1=HMAC-SHA256(secret, `${t}.${corps}`)", () => {
    const expected = createHmac("sha256", SECRET).update(`${T}.${BODY}`).digest("hex");
    assert.equal(signWebhook(SECRET, T, BODY), `t=${T},v1=${expected}`);
    assert.equal(signWebhook(SECRET, T, Buffer.from(BODY)), `t=${T},v1=${expected}`, "chaîne ou Buffer : mêmes octets");
  });

  it("verifyWebhookSignature accepte une signature valide dans la tolérance", () => {
    const header = signWebhook(SECRET, T, BODY);
    assert.equal(verifyWebhookSignature(SECRET, header, BODY, 300, T), true);
    assert.equal(verifyWebhookSignature(SECRET, header, BODY, 300, T + 299), true);
    assert.equal(verifyWebhookSignature(SECRET, header, BODY, 300, T - 299), true);
  });

  it("refuse un horodatage trop vieux (ou trop dans le futur)", () => {
    const header = signWebhook(SECRET, T, BODY);
    assert.equal(verifyWebhookSignature(SECRET, header, BODY, 300, T + 301), false);
    assert.equal(verifyWebhookSignature(SECRET, header, BODY, 300, T - 301), false);
    assert.equal(verifyWebhookSignature(SECRET, header, BODY, 60, T + 61), false, "tolérance personnalisée");
  });

  it("refuse une signature modifiée, un corps modifié, un autre secret ou un timestamp modifié", () => {
    const header = signWebhook(SECRET, T, BODY);
    const v1 = header.split("v1=")[1];
    const flipped = (v1[0] === "a" ? "b" : "a") + v1.slice(1);
    assert.equal(verifyWebhookSignature(SECRET, `t=${T},v1=${flipped}`, BODY, 300, T), false);
    assert.equal(verifyWebhookSignature(SECRET, header, BODY.replace("succeeded", "failed"), 300, T), false);
    assert.equal(verifyWebhookSignature("autre-secret", header, BODY, 300, T), false);
    assert.equal(verifyWebhookSignature(SECRET, `t=${T + 1},v1=${v1}`, BODY, 300, T), false);
  });

  it("refuse les en-têtes absents ou mal formés", () => {
    for (const header of [undefined, null, "", "t=abc,v1=00", `t=${T}`, "v1=" + "0".repeat(64), `t=${T},v1=xyz`, `t=${T},v1=${"0".repeat(10)}`]) {
      assert.equal(verifyWebhookSignature(SECRET, header, BODY, 300, T), false, String(header));
    }
  });

  it("accepte plusieurs v1 (rotation de secret) si l'un d'eux est valide", () => {
    const good = signWebhook(SECRET, T, BODY).split("v1=")[1];
    assert.equal(verifyWebhookSignature(SECRET, `t=${T},v1=${"0".repeat(64)},v1=${good}`, BODY, 300, T), true);
  });
});
