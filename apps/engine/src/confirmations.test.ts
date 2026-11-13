import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { projectChannel, validateSimulatorYaml, type PhoneSession } from "@hifrica/shared";
import Fastify from "fastify";
import { Redis } from "ioredis";
import { handleConfirmationMessage, registerConfirmations, type ConfirmationDeps } from "./confirmations.js";
import { firedKey, startPaymentSession, type SessionStore } from "./phone-session.js";
import { paymentPendingEvent } from "./response.js";
import type { Simulator } from "./simulators.js";
import { registerValkey } from "./valkey.js";
import type { ScheduleWebhookOptions } from "./webhooks.js";

// Le vrai simulateur du dépôt : on vérifie aussi son corps de webhook ({{response.id}}, montant typé).
const YAML = readFileSync(new URL("../../../simulators/paiement-mobile-generique.yaml", import.meta.url), "utf8");
const parsed = validateSimulatorYaml(YAML);
assert.ok(parsed.valid, parsed.errors.join("; "));
const SIMULATOR = parsed.simulator as Simulator;
const simulators = new Map([[SIMULATOR.name, SIMULATOR]]);

const CHECKOUT_ID = "7c0a9e7e-3f4b-4a8e-9d2b-0123456789ab";

function session(overrides: Partial<PhoneSession> = {}): PhoneSession {
  return {
    sessionId: CHECKOUT_ID,
    projectId: "demo",
    simulator: SIMULATOR.name,
    endpointId: "checkout",
    requestId: "req-origine",
    status: "confirmed",
    createdAt: new Date().toISOString(),
    ctx: { body: { amount: 5000, merchant: "Boutique" }, query: {}, params: {} },
    response: { status: 201, body: { id: CHECKOUT_ID, status: "pending", amount: 5000, currency: "XOF" } },
    ...overrides,
  };
}

/** Store en mémoire : sessions et clés « fired » (SET NX). */
function memoryStore(initial: PhoneSession[] = []) {
  const sessions = new Map(initial.map((s) => [s.sessionId, JSON.parse(JSON.stringify(s)) as unknown]));
  const fired = new Set<string>();
  const store: SessionStore = {
    async create(s) {
      if (sessions.has(s.sessionId)) return false;
      sessions.set(s.sessionId, JSON.parse(JSON.stringify(s)));
      return true;
    },
    async get(id) {
      return sessions.get(id) ?? null;
    },
    async markFired(id) {
      if (fired.has(id)) return false;
      fired.add(id);
      return true;
    },
  };
  return { store, sessions, fired };
}

function setup(initial: PhoneSession[] = [session()], store?: SessionStore) {
  const scheduled: ScheduleWebhookOptions[] = [];
  const lines: { level: string; msg?: string; obj: unknown }[] = [];
  const at = (level: string) => (obj: unknown, msg?: string) => void lines.push({ level, obj, msg });
  const mem = memoryStore(initial);
  const deps: ConfirmationDeps = {
    simulators,
    store: store ?? mem.store,
    schedule: async (opts) => void scheduled.push(opts),
    log: { info: at("info"), warn: at("warn"), error: at("error") } as never,
  };
  return { deps, scheduled, lines, mem };
}

const event = (type: "phone.confirm" | "phone.reject", overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ type, sessionId: CHECKOUT_ID, projectId: "demo", createdAt: new Date().toISOString(), requestId: "req-api", ...overrides });

const CHANNEL = projectChannel("demo");

describe("A4 : webhook déclenché par la confirmation du téléphone", () => {
  it("phone.confirm → scheduleWebhook une fois, avec le corps du YAML et le même id que la réponse", async () => {
    const { deps, scheduled } = setup();
    assert.equal(await handleConfirmationMessage(CHANNEL, event("phone.confirm"), deps), "scheduled");
    assert.equal(scheduled.length, 1);
    assert.deepEqual(scheduled[0], {
      projectId: "demo",
      simulator: "paiement-mobile-generique",
      requestId: "req-origine", // celui de la requête d'origine (session), pas celui de l'API
      event: "checkout.completed",
      body: { id: CHECKOUT_ID, status: "succeeded", amount: 5000, currency: "XOF" },
      delayMs: 0,
    });
  });

  it("un deuxième phone.confirm identique est ignoré (dédoublonnage)", async () => {
    const { deps, scheduled, mem } = setup();
    await handleConfirmationMessage(CHANNEL, event("phone.confirm"), deps);
    assert.equal(await handleConfirmationMessage(CHANNEL, event("phone.confirm"), deps), "duplicate");
    assert.equal(scheduled.length, 1);
    assert.ok(mem.fired.has(CHECKOUT_ID));
  });

  it("deux phone.confirm simultanés → un seul webhook", async () => {
    const { deps, scheduled } = setup();
    const results = await Promise.all([1, 2, 3].map(() => handleConfirmationMessage(CHANNEL, event("phone.confirm"), deps)));
    assert.deepEqual(results.sort(), ["duplicate", "duplicate", "scheduled"]);
    assert.equal(scheduled.length, 1);
  });

  it("session absente ou expirée → ignoré", async () => {
    const { deps, scheduled, lines } = setup([]);
    assert.equal(await handleConfirmationMessage(CHANNEL, event("phone.confirm"), deps), "session_missing");
    assert.equal(scheduled.length, 0);
    assert.ok(lines.some((l) => l.msg?.includes("session absente ou expirée")));
  });

  it("session invalide (ex. corrompue) → ignoré comme absente", async () => {
    const mem = memoryStore();
    mem.sessions.set(CHECKOUT_ID, { sessionId: CHECKOUT_ID, projectId: "demo" });
    const { deps, scheduled } = setup([], mem.store);
    assert.equal(await handleConfirmationMessage(CHANNEL, event("phone.confirm"), deps), "session_missing");
    assert.equal(scheduled.length, 0);
  });

  it("projectId différent de celui de la session → ignoré", async () => {
    const { deps, scheduled } = setup([session({ projectId: "autre-projet" })]);
    assert.equal(await handleConfirmationMessage(CHANNEL, event("phone.confirm"), deps), "project_mismatch");
    assert.equal(scheduled.length, 0);
  });

  it("événement publié sur le canal d'un autre projet → ignoré", async () => {
    const { deps, scheduled } = setup();
    assert.equal(await handleConfirmationMessage(projectChannel("autre"), event("phone.confirm"), deps), "channel_mismatch");
    assert.equal(scheduled.length, 0);
  });

  it("phone.reject sans webhook « on: phone.reject » → rien n'est envoyé", async () => {
    const { deps, scheduled, lines } = setup([session({ status: "rejected" })]);
    assert.equal(await handleConfirmationMessage(CHANNEL, event("phone.reject", { reason: "wrong_pin" }), deps), "no_webhook");
    assert.equal(scheduled.length, 0);
    assert.ok(lines.some((l) => l.msg?.includes("aucun webhook « on: phone.reject »")));
  });

  it("phone.reject avec un webhook « on: phone.reject » → envoyé", async () => {
    const sim: Simulator = JSON.parse(JSON.stringify(SIMULATOR));
    sim.endpoints![0].webhook = { on: "phone.reject", event: "checkout.failed", after: "2s", body: { id: "{{response.id}}", status: "failed" } };
    const { deps, scheduled } = setup([session({ status: "rejected" })]);
    deps.simulators = new Map([[sim.name, sim]]);
    assert.equal(await handleConfirmationMessage(CHANNEL, event("phone.reject"), deps), "scheduled");
    assert.deepEqual([scheduled[0].event, scheduled[0].body, scheduled[0].delayMs], ["checkout.failed", { id: CHECKOUT_ID, status: "failed" }, 2000]);
  });

  it("statut de session incohérent → ignoré, sans consommer le dédoublonnage", async () => {
    const { deps, scheduled, mem } = setup([session({ status: "pending" })]);
    assert.equal(await handleConfirmationMessage(CHANNEL, event("phone.confirm"), deps), "status_mismatch");
    assert.equal(mem.fired.size, 0);
    // B1 met ensuite la session à jour : la confirmation suivante passe.
    mem.sessions.set(CHECKOUT_ID, JSON.parse(JSON.stringify(session({ status: "confirmed" }))));
    assert.equal(await handleConfirmationMessage(CHANNEL, event("phone.confirm"), deps), "scheduled");
    assert.equal(scheduled.length, 1);
  });

  it("autres événements ignorés en silence ; messages invalides ignorés avec un avertissement", async () => {
    const { deps, scheduled, lines } = setup();
    const pending = JSON.stringify({
      type: "payment.pending", sessionId: CHECKOUT_ID, projectId: "demo", simulator: "s", endpointId: "checkout",
      amount: 5000, screen: "confirm-payment", text: "Payer", createdAt: new Date().toISOString(),
    });
    assert.equal(await handleConfirmationMessage(CHANNEL, pending, deps), "ignored");
    assert.equal(lines.length, 0);
    assert.equal(await handleConfirmationMessage(CHANNEL, "pas du json", deps), "invalid_event");
    assert.equal(await handleConfirmationMessage(CHANNEL, JSON.stringify({ type: "phone.confirm" }), deps), "invalid_event");
    assert.equal(scheduled.length, 0);
  });

  it("Valkey injoignable → ignoré avec un avertissement, sans exception", async () => {
    const failing: SessionStore = {
      create: async () => false,
      get: async () => {
        throw new Error("valkey_not_ready (reconnecting)");
      },
      markFired: async () => true,
    };
    const { deps, scheduled, lines } = setup([], failing);
    assert.equal(await handleConfirmationMessage(CHANNEL, event("phone.confirm"), deps), "valkey_error");
    assert.equal(scheduled.length, 0);
    assert.ok(lines.some((l) => l.level === "warn"));
  });

  it("les logs ne contiennent ni le corps de la requête ni celui de la réponse", async () => {
    const { deps, lines } = setup([session({ ctx: { body: { amount: 5000, merchant: "Marchand-Confidentiel" }, query: {}, params: {} } })]);
    await handleConfirmationMessage(CHANNEL, event("phone.confirm"), deps);
    await handleConfirmationMessage(CHANNEL, event("phone.confirm"), deps);
    assert.ok(!JSON.stringify(lines).includes("Marchand-Confidentiel"));
  });
});

describe("A3 + A4 avec un vrai Valkey (TEST_VALKEY_URL)", { skip: !process.env.TEST_VALKEY_URL }, () => {
  it("session écrite avec TTL, PUBLISH phone.confirm → un seul webhook, même id que la réponse", async () => {
    const url = process.env.TEST_VALKEY_URL as string;
    const app = Fastify({ logger: false });
    registerValkey(app, { VALKEY_URL: url });
    const scheduled: ScheduleWebhookOptions[] = [];
    registerConfirmations(app, simulators, { schedule: async (opts) => void scheduled.push(opts) });
    await app.ready();
    const admin = new Redis(url);
    try {
      const id = `it-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const ctx = { body: { amount: 7000, merchant: "Boutique" }, query: {}, params: {} };
      const response = { status: 201, headers: {}, body: { id, status: "pending", amount: 7000, currency: "XOF" } };
      const endpoint = SIMULATOR.endpoints!.find((e) => e.id === "checkout")!;
      const pending = paymentPendingEvent({ projectId: "demo", simulator: SIMULATOR.name, endpoint, ctx, response, requestId: "req-it" });
      assert.ok(pending);
      await waitFor(() => admin.status === "ready");
      // Le client partagé du moteur se connecte au premier usage : on attend qu'il soit prêt.
      let result = await startPaymentSession({ event: pending, ctx, response, log: console, publish: async () => undefined });
      for (let i = 0; !result.ok && i < 50; i++) {
        await sleep(50);
        result = await startPaymentSession({ event: pending, ctx, response, log: console, publish: async () => undefined });
      }
      assert.deepEqual(result, { ok: true });
      const ttl = await admin.ttl(`phone-session:${id}`);
      assert.ok(ttl > 590 && ttl <= 600, `TTL ${ttl}`);

      // B1 : statut confirmé, puis publication (deux fois : la seconde doit être ignorée).
      const stored = JSON.parse((await admin.get(`phone-session:${id}`)) as string) as PhoneSession;
      await admin.set(`phone-session:${id}`, JSON.stringify({ ...stored, status: "confirmed" }), "KEEPTTL");
      const message = JSON.stringify({ type: "phone.confirm", sessionId: id, projectId: "demo", createdAt: new Date().toISOString() });
      await waitFor(async () => (await admin.publish(projectChannel("demo"), message)) > 0);
      await waitFor(async () => scheduled.length === 1);
      await admin.publish(projectChannel("demo"), message);
      await sleep(300);
      assert.equal(scheduled.length, 1);
      assert.deepEqual(scheduled[0].body, { id, status: "succeeded", amount: 7000, currency: "XOF" });
      assert.equal(scheduled[0].requestId, "req-it");
      assert.equal(await admin.get(firedKey(id)), "1");
      assert.ok((await admin.ttl(firedKey(id))) > 590);
    } finally {
      admin.disconnect();
      await app.close();
    }
  });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(condition: () => Promise<boolean> | boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeoutMs) throw new Error("condition jamais remplie");
    await sleep(25);
  }
}
