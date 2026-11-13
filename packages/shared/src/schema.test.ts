import assert from "node:assert/strict";
import { Ajv } from "ajv";
import { describe, it } from "node:test";
import { simulatorSchema } from "./schema.js";

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(simulatorSchema);

function ussdSimulator(startMenuExtra: Record<string, unknown> = {}): unknown {
  return {
    name: "test-ussd",
    version: "1.0.0",
    kind: "ussd",
    code: "*123#",
    menus: {
      start: { text: "Bienvenue", ...startMenuExtra },
    },
  };
}

function httpSimulator(phone: Record<string, unknown>): unknown {
  return {
    name: "test-http",
    version: "1.0.0",
    kind: "http",
    auth: "bearer",
    endpoints: [
      {
        id: "send",
        method: "POST",
        path: "/v1/send",
        response: { status: 201 },
        phone,
      },
    ],
  };
}

describe("schéma YAML — sensitive sur ussdMenu", () => {
  it("valide un menu sans sensitive", () => {
    assert.equal(validate(ussdSimulator()), true, JSON.stringify(validate.errors));
  });

  it("valide sensitive: true", () => {
    assert.equal(validate(ussdSimulator({ sensitive: true })), true, JSON.stringify(validate.errors));
  });

  it("valide sensitive: false", () => {
    assert.equal(validate(ussdSimulator({ sensitive: false })), true, JSON.stringify(validate.errors));
  });

  it("refuse une valeur non booléenne pour sensitive", () => {
    assert.equal(validate(ussdSimulator({ sensitive: "oui" })), false);
    const messages = (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
    assert.ok(
      messages.some((m) => m.includes("sensitive") && m.includes("boolean")),
      `erreur attendue sur sensitive/boolean, reçu : ${messages.join("; ")}`,
    );
  });
});

describe("schéma YAML — bloc phone, écran sms", () => {
  it("valide un écran sms avec from, to et text", () => {
    const sim = httpSimulator({ screen: "sms", from: "HIFRICA", to: "{{body.phone}}", text: "Code : {{response.code}}" });
    assert.equal(validate(sim), true, JSON.stringify(validate.errors));
  });

  it("refuse un écran sms sans from ni to", () => {
    assert.equal(validate(httpSimulator({ screen: "sms", text: "Code" })), false);
    const messages = (validate.errors ?? []).map((e) => e.message);
    assert.ok(messages.some((m) => m?.includes("from")));
  });

  it("confirm-payment n'exige ni from ni to (comportement inchangé)", () => {
    const sim = httpSimulator({ screen: "confirm-payment", text: "Payer {{body.amount}} ?" });
    assert.equal(validate(sim), true, JSON.stringify(validate.errors));
  });

  it("sans screen (défaut confirm-payment) n'exige ni from ni to", () => {
    assert.equal(validate(httpSimulator({ text: "Payer ?" })), true, JSON.stringify(validate.errors));
  });
});
