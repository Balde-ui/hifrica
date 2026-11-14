import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHifricaEvent } from "@hifrica/shared";
import { smsReceivedEvent } from "./response.js";
import type { Endpoint } from "./simulators.js";

const endpoint: Endpoint = {
  id: "send-otp",
  method: "POST",
  path: "/v1/otp",
  response: { status: 201 },
  phone: { screen: "sms", from: "HIFRICA", to: "{{body.phone}}", text: "Code : {{response.code}}" },
};

describe("smsReceivedEvent", () => {
  it("construit sms.received à partir du bloc phone (gabarits body + response rendus)", () => {
    const ctx = { body: { phone: "+221770000000" }, query: {}, params: {}, response: { code: "123456" } };
    const event = smsReceivedEvent({ projectId: "proj-1", endpoint, ctx, requestId: "req-1" });
    assert.ok(event);
    assert.equal(event.type, "sms.received");
    assert.equal(event.projectId, "proj-1");
    assert.equal(event.from, "HIFRICA");
    assert.equal(event.to, "+221770000000");
    assert.equal(event.text, "Code : 123456");
    assert.equal(event.requestId, "req-1");
    assert.ok(event.messageId.length > 0);
    assert.ok(isHifricaEvent(event), "doit être un HifricaEvent valide (champs requis au complet)");
  });

  it("deux appels produisent deux messageId différents (pas de réutilisation entre notifications)", () => {
    const ctx = { body: { phone: "+221770000000" }, query: {}, params: {}, response: { code: "123456" } };
    const a = smsReceivedEvent({ projectId: "proj-1", endpoint, ctx });
    const b = smsReceivedEvent({ projectId: "proj-1", endpoint, ctx });
    assert.notEqual(a?.messageId, b?.messageId);
  });

  it("écran différent de sms → undefined (pas de notification pour confirm-payment ou notification)", () => {
    const ctx = { body: {}, query: {}, params: {} };
    for (const screen of ["confirm-payment", "notification", undefined] as const) {
      const e: Endpoint = { ...endpoint, phone: { ...endpoint.phone, screen } };
      assert.equal(smsReceivedEvent({ projectId: "proj-1", endpoint: e, ctx }), undefined, `screen=${screen}`);
    }
  });

  it("from, to ou text manquant → undefined (le schéma l'empêche déjà à la validation du YAML)", () => {
    const ctx = { body: { phone: "+221770000000" }, query: {}, params: {} };
    for (const phone of [
      { screen: "sms" as const, to: "{{body.phone}}", text: "Code" },
      { screen: "sms" as const, from: "HIFRICA", text: "Code" },
      { screen: "sms" as const, from: "HIFRICA", to: "{{body.phone}}" },
    ]) {
      assert.equal(smsReceivedEvent({ projectId: "proj-1", endpoint: { ...endpoint, phone }, ctx }), undefined);
    }
  });

  it("sans bloc phone → undefined", () => {
    const { phone: _phone, ...withoutPhone } = endpoint;
    assert.equal(smsReceivedEvent({ projectId: "proj-1", endpoint: withoutPhone, ctx: { body: {}, query: {}, params: {} } }), undefined);
  });
});
