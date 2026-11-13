import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHifricaEvent } from "./events.js";

const base = {
  type: "phone.confirm",
  sessionId: "sess-1",
  projectId: "proj-1",
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

describe("isHifricaEvent — requestId", () => {
  it("accepte requestId absent", () => {
    assert.equal(isHifricaEvent({ ...base }), true);
  });

  it("accepte requestId sous forme de chaîne", () => {
    assert.equal(isHifricaEvent({ ...base, requestId: "req-1" }), true);
  });

  it("refuse requestId numérique", () => {
    assert.equal(isHifricaEvent({ ...base, requestId: 123 }), false);
  });

  it("refuse requestId null", () => {
    assert.equal(isHifricaEvent({ ...base, requestId: null }), false);
  });
});

describe("isHifricaEvent — robustesse (déjà couvert, non régressé)", () => {
  it("refuse une propriété héritée comme type (constructor) sans lever", () => {
    assert.equal(isHifricaEvent({ type: "constructor" }), false);
  });

  it("refuse un amount non fini ou négatif", () => {
    const paymentBase = {
      type: "payment.pending",
      sessionId: "s",
      projectId: "p",
      simulator: "sim",
      endpointId: "ep",
      screen: "confirm-payment",
      text: "Payer ?",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    assert.equal(isHifricaEvent({ ...paymentBase, amount: Number.NaN }), false);
    assert.equal(isHifricaEvent({ ...paymentBase, amount: -1 }), false);
    assert.equal(isHifricaEvent({ ...paymentBase, amount: 5000 }), true);
  });
});
