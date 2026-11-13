// Tests du contrat partagé des sessions de paiement (sessions.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPhoneSession, PHONE_SESSION_TTL_SEC, phoneSessionKey, type PhoneSession } from "./sessions.js";

const valid = (): PhoneSession => ({
  sessionId: "8f0c3e2a-1b2c-4d5e-8f90-123456789abc",
  projectId: "demo",
  simulator: "paiement-mobile-generique",
  endpointId: "checkout",
  requestId: "req-1",
  status: "pending",
  createdAt: "2026-11-13T10:00:00.000Z",
  ctx: { body: { amount: 5000 }, query: {}, params: {} },
  response: { status: 201, body: { id: "8f0c3e2a-1b2c-4d5e-8f90-123456789abc" } },
});

describe("sessions de paiement (contrat partagé)", () => {
  it("clé et durée de vie", () => {
    assert.equal(phoneSessionKey("abc"), "phone-session:abc");
    assert.equal(PHONE_SESSION_TTL_SEC, 600);
  });

  it("accepte une session valide, avec ou sans requestId, quel que soit le statut", () => {
    assert.equal(isPhoneSession(valid()), true);
    const { requestId: _omit, ...withoutRequestId } = valid();
    assert.equal(isPhoneSession(withoutRequestId), true);
    for (const status of ["pending", "confirmed", "rejected"] as const) {
      assert.equal(isPhoneSession({ ...valid(), status }), true, status);
    }
    assert.equal(isPhoneSession({ ...valid(), response: { status: 201, body: null } }), true, "corps de réponse null accepté");
  });

  it("refuse null, les tableaux et les valeurs non objet", () => {
    for (const value of [null, undefined, 42, "session", [], [valid()]]) {
      assert.equal(isPhoneSession(value), false, String(value));
    }
  });

  it("refuse un champ obligatoire absent, null ou seulement hérité du prototype", () => {
    for (const field of ["sessionId", "projectId", "simulator", "endpointId", "status", "createdAt", "ctx", "response"] as const) {
      const missing: Record<string, unknown> = { ...valid() };
      delete missing[field];
      assert.equal(isPhoneSession(missing), false, `${field} absent`);
      assert.equal(isPhoneSession({ ...valid(), [field]: null }), false, `${field} null`);
      const inherited = Object.create({ [field]: (valid() as unknown as Record<string, unknown>)[field] }) as Record<string, unknown>;
      Object.assign(inherited, missing);
      assert.equal(isPhoneSession(inherited), false, `${field} hérité`);
    }
  });

  it("vérifie les types de chaque champ", () => {
    const bad: [string, unknown][] = [
      ["sessionId", ""],
      ["sessionId", 42],
      ["projectId", ""],
      ["simulator", 1],
      ["endpointId", {}],
      ["requestId", 42],
      ["requestId", null],
      ["status", "done"],
      ["status", "PENDING"],
      ["createdAt", "pas une date"],
      ["createdAt", 1794000000],
      ["ctx", []],
      ["ctx", { body: {}, query: {} }],
      ["ctx", { body: [], query: {}, params: {} }],
      ["ctx", { body: {}, query: null, params: {} }],
      ["ctx", { body: {}, query: {}, params: { id: 42 } }],
      ["response", { body: {} }],
      ["response", { status: 201 }],
      ["response", { status: "201", body: {} }],
      ["response", { status: 99, body: {} }],
      ["response", { status: 600, body: {} }],
      ["response", { status: 201.5, body: {} }],
    ];
    for (const [field, value] of bad) {
      assert.equal(isPhoneSession({ ...valid(), [field]: value }), false, `${field} = ${JSON.stringify(value)}`);
    }
  });

  it("une session relue depuis JSON reste valide (aller-retour Valkey)", () => {
    assert.equal(isPhoneSession(JSON.parse(JSON.stringify(valid()))), true);
  });
});
