import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPhoneSession, type PaymentPendingEvent, type PhoneSession } from "@hifrica/shared";
import type { Redis } from "ioredis";
import { createValkeySessionStore, startPaymentSession, type SessionStore } from "./phone-session.js";
import { paymentPendingEvent } from "./response.js";
import type { Endpoint } from "./simulators.js";

const endpoint: Endpoint = {
  id: "checkout",
  method: "POST",
  path: "/v1/checkout",
  response: { status: 201 },
  phone: { screen: "confirm-payment", text: "Payer {{body.amount}} FCFA à {{body.merchant}} ?" },
  webhook: { on: "phone.confirm", event: "checkout.completed", body: { id: "{{response.id}}" } },
};
const ctx = { body: { amount: 5000, merchant: "Boutique" }, query: {}, params: {} };
const response = { status: 201, headers: {}, body: { id: "chk-0001", status: "pending", amount: 5000, currency: "XOF" } };

const silentLog = () => {
  const lines: { level: string; msg?: string; obj: unknown }[] = [];
  const at = (level: string) => (obj: unknown, msg?: string) => void lines.push({ level, obj, msg });
  return { log: { info: at("info"), warn: at("warn"), error: at("error") } as never, lines };
};

/** Faux client ioredis : enregistre les commandes, simule SET NX / GET. */
function fakeRedis(status = "ready") {
  const data = new Map<string, string>();
  const calls: unknown[][] = [];
  const client = {
    status,
    async set(...args: unknown[]) {
      calls.push(["set", ...args]);
      const [key, value, , , mode] = args as [string, string, string, number, string];
      if (mode === "NX" && data.has(key)) return null;
      data.set(key, value);
      return "OK";
    },
    async get(key: string) {
      calls.push(["get", key]);
      return data.get(key) ?? null;
    },
  };
  return { client: client as unknown as Redis, calls, data };
}

describe("A3 : session de paiement", () => {
  it("payment.pending porte le requestId et sessionId = id du checkout renvoyé", () => {
    const event = paymentPendingEvent({ projectId: "demo", simulator: "paiement-mobile-generique", endpoint, ctx, response, requestId: "req-9" });
    assert.ok(event);
    assert.equal(event.sessionId, "chk-0001");
    assert.equal(event.requestId, "req-9");
    assert.equal(event.text, "Payer 5000 FCFA à Boutique ?");
  });

  it("la session est écrite avec SET … EX 600 NX, puis l'événement est publié", async () => {
    const redis = fakeRedis();
    const store = createValkeySessionStore(() => redis.client);
    const published: PaymentPendingEvent[] = [];
    const event = paymentPendingEvent({ projectId: "demo", simulator: "paiement-mobile-generique", endpoint, ctx, response, requestId: "req-9" });
    assert.ok(event);
    const { log } = silentLog();

    const result = await startPaymentSession({ event, ctx, response, log, store, publish: async (e) => void published.push(e) });
    assert.deepEqual(result, { ok: true });

    const [cmd, key, json, ex, ttl, nx] = redis.calls[0] as [string, string, string, string, number, string];
    assert.deepEqual([cmd, key, ex, ttl, nx], ["set", "phone-session:chk-0001", "EX", 600, "NX"]);
    const session = JSON.parse(json) as PhoneSession;
    assert.equal(isPhoneSession(session), true);
    assert.deepEqual(
      [session.sessionId, session.projectId, session.simulator, session.endpointId, session.requestId, session.status],
      ["chk-0001", "demo", "paiement-mobile-generique", "checkout", "req-9", "pending"],
    );
    assert.deepEqual(session.ctx, ctx);
    assert.deepEqual(session.response, { status: 201, body: response.body });

    assert.equal(published.length, 1, "publié après l'écriture");
    assert.equal(published[0].requestId, "req-9");
    assert.equal(published[0].sessionId, "chk-0001");
  });

  it("Valkey absent ou pas prêt → aucun événement publié, avertissement, pas d'exception", async () => {
    for (const client of [null, fakeRedis("reconnecting").client]) {
      const store = createValkeySessionStore(() => client);
      const published: unknown[] = [];
      const { log, lines } = silentLog();
      const event = paymentPendingEvent({ projectId: "demo", simulator: "s", endpoint, ctx, response, requestId: "r" });
      assert.ok(event);
      const result = await startPaymentSession({ event, ctx, response, log, store, publish: async (e) => void published.push(e) });
      assert.equal(result.ok, false);
      assert.equal(published.length, 0);
      assert.ok(lines.some((l) => l.level === "warn" && l.msg?.includes("payment.pending non publié")));
    }
  });

  it("session déjà existante (NX) → pas de seconde publication", async () => {
    const redis = fakeRedis();
    const store = createValkeySessionStore(() => redis.client);
    const published: unknown[] = [];
    const { log } = silentLog();
    const event = paymentPendingEvent({ projectId: "demo", simulator: "s", endpoint, ctx, response, requestId: "r" });
    assert.ok(event);
    const publish = async (e: PaymentPendingEvent) => void published.push(e);
    await startPaymentSession({ event, ctx, response, log, store, publish });
    const second = await startPaymentSession({ event, ctx, response, log, store, publish });
    assert.deepEqual(second, { ok: false, reason: "session_exists" });
    assert.equal(published.length, 1);
  });

  it("une erreur de publication ne fait pas échouer l'appel", async () => {
    const store: SessionStore = { create: async () => true, get: async () => null, markFired: async () => true };
    const { log, lines } = silentLog();
    const event = paymentPendingEvent({ projectId: "demo", simulator: "s", endpoint, ctx, response });
    assert.ok(event);
    const result = await startPaymentSession({
      event, ctx, response, log, store,
      publish: async () => {
        throw new Error("boom");
      },
    });
    assert.deepEqual(result, { ok: true });
    assert.ok(lines.some((l) => l.level === "error"));
  });
});
