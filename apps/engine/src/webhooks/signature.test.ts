// La signature est testée dans packages/shared (webhook-signature.test.ts). Ici, on vérifie seulement que le
// moteur réexporte bien la même implémentation.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as shared from "@hifrica/shared/webhook-signature";
import { signWebhook, verifyWebhookSignature } from "./signature.js";

describe("signature des webhooks (réexportation)", () => {
  it("le moteur utilise exactement les fonctions de @hifrica/shared/webhook-signature", () => {
    assert.equal(signWebhook, shared.signWebhook);
    assert.equal(verifyWebhookSignature, shared.verifyWebhookSignature);
  });

  it("une signature produite par le moteur se vérifie", () => {
    const t = Math.floor(Date.now() / 1000);
    const header = signWebhook("secret", t, '{"id":"d1"}');
    assert.match(header, /^t=\d+,v1=[0-9a-f]{64}$/);
    assert.equal(verifyWebhookSignature("secret", header, '{"id":"d1"}'), true);
  });
});
