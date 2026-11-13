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
