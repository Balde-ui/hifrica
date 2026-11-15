import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { isHifricaEvent, phoneSessionKey, projectChannel, type PhoneSession } from "@hifrica/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import {
  exceedsPhoneActionRateLimit,
  PHONE_ACTION_RATE_LIMIT,
  PHONE_ACTION_RATE_WINDOW_SEC,
  registerPhoneAction,
  type PhoneActionDeps,
} from "./phone.js";
import { registerValkey, sharedValkey } from "./valkey.js";

// L'authentification réelle (Better Auth) n'est pas configurée dans ce test : on bouchonne requireUser/
// assertProjectOwner pour tester la logique de phone.ts indépendamment de C2.
const fakeAuth: PhoneActionDeps = {
  requireUser: async () => ({ id: "test-user", email: "test@example.com", name: "Test" }),
  assertProjectOwner: async () => true,
};

function session(overrides: Partial<PhoneSession> = {}): PhoneSession {
  return {
    sessionId: "will-be-set",
    projectId: "demo",
    simulator: "paiement-mobile-generique",
    endpointId: "checkout",
    status: "pending",
    createdAt: new Date().toISOString(),
    ctx: { body: { amount: 5000 }, query: {}, params: {} },
    response: { status: 201, body: { id: "x" } },
    ...overrides,
  };
}

describe(
  "POST /api/phone/:session/action — avec un vrai Valkey (TEST_VALKEY_URL)",
  { skip: !process.env.TEST_VALKEY_URL },
  () => {
    const url = process.env.TEST_VALKEY_URL as string;
    let app: FastifyInstance;
    let admin: Redis;

    before(async () => {
      app = Fastify({ logger: false });
      registerValkey(app, { VALKEY_URL: url });
      registerPhoneAction(app, fakeAuth);
      await app.ready();
      // Le client partagé se connecte au premier usage : on attend qu'il soit prêt avant les requêtes.
      await waitFor(() => sharedValkey()?.status === "ready");
      admin = new Redis(url);
      await waitFor(() => admin.status === "ready");
    });

    after(async () => {
      admin.disconnect();
      await app.close();
    });

    async function seed(s: PhoneSession): Promise<void> {
      await admin.set(phoneSessionKey(s.sessionId), JSON.stringify(s), "EX", 600);
    }

    it("confirm sur une session pending : 200, status mis à jour, phone.confirm publié", async () => {
      const id = `it-confirm-${Date.now()}`;
      await seed(session({ sessionId: id }));
      const sub = new Redis(url);
      const received: unknown[] = [];
      sub.on("message", (_c: string, m: string) => received.push(JSON.parse(m)));
      await sub.subscribe(projectChannel("demo"));

      try {
        const res = await app.inject({ method: "POST", url: `/api/phone/${id}/action`, payload: { action: "confirm" } });
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.json(), { status: "confirmed" });

        const stored = JSON.parse((await admin.get(phoneSessionKey(id))) as string) as PhoneSession;
        assert.equal(stored.status, "confirmed");
        const ttl = await admin.ttl(phoneSessionKey(id));
        assert.ok(ttl > 590, `TTL conservé (KEEPTTL), reçu ${ttl}`);

        await waitFor(() => received.length === 1);
        assert.equal(isHifricaEvent(received[0]), true);
        const event = received[0] as Record<string, unknown>;
        assert.equal(event.type, "phone.confirm");
        assert.equal(event.sessionId, id);
        assert.equal(event.projectId, "demo");
        assert.equal(typeof event.requestId, "string");
      } finally {
        sub.disconnect();
      }
    });

    it("reject avec reason : 200, phone.reject publié avec le motif, sans aucun champ pin", async () => {
      const id = `it-reject-${Date.now()}`;
      await seed(session({ sessionId: id }));
      const sub = new Redis(url);
      const received: unknown[] = [];
      sub.on("message", (_c: string, m: string) => received.push(JSON.parse(m)));
      await sub.subscribe(projectChannel("demo"));

      try {
        const res = await app.inject({
          method: "POST",
          url: `/api/phone/${id}/action`,
          payload: { action: "reject", reason: "wrong_pin" },
        });
        assert.equal(res.statusCode, 200);
        await waitFor(() => received.length === 1);
        const event = received[0] as Record<string, unknown>;
        assert.equal(event.type, "phone.reject");
        assert.equal(event.reason, "wrong_pin");
        assert.ok(!("pin" in event), "le PIN ne doit jamais apparaître dans l'événement publié");
      } finally {
        sub.disconnect();
      }
    });

    it("une deuxième action sur la même session → 409 already_handled, rien de publié deux fois", async () => {
      const id = `it-double-${Date.now()}`;
      await seed(session({ sessionId: id }));

      const first = await app.inject({ method: "POST", url: `/api/phone/${id}/action`, payload: { action: "confirm" } });
      assert.equal(first.statusCode, 200);
      const second = await app.inject({ method: "POST", url: `/api/phone/${id}/action`, payload: { action: "reject" } });
      assert.equal(second.statusCode, 409);
      assert.deepEqual(second.json(), { error: "already_handled" });
    });

    it("session déjà confirmée (status non pending) → 409 sans tenter le verrou", async () => {
      const id = `it-already-${Date.now()}`;
      await seed(session({ sessionId: id, status: "confirmed" }));
      const res = await app.inject({ method: "POST", url: `/api/phone/${id}/action`, payload: { action: "confirm" } });
      assert.equal(res.statusCode, 409);
    });

    it("session inconnue → 404 session_not_found", async () => {
      const res = await app.inject({ method: "POST", url: "/api/phone/inconnue/action", payload: { action: "confirm" } });
      assert.equal(res.statusCode, 404);
      assert.deepEqual(res.json(), { error: "session_not_found" });
    });

    it("action invalide → 400 ; reason trop longue → 400", async () => {
      const id = `it-invalid-${Date.now()}`;
      await seed(session({ sessionId: id }));
      const bad = await app.inject({ method: "POST", url: `/api/phone/${id}/action`, payload: { action: "cancel" } });
      assert.equal(bad.statusCode, 400);
      assert.deepEqual(bad.json(), { error: "invalid_action" });

      const longReason = await app.inject({
        method: "POST",
        url: `/api/phone/${id}/action`,
        payload: { action: "reject", reason: "x".repeat(65) },
      });
      assert.equal(longReason.statusCode, 400);
      assert.deepEqual(longReason.json(), { error: "invalid_reason" });
    });

    it(`au-delà de ${PHONE_ACTION_RATE_LIMIT} actions par fenêtre pour le même compte → 429, avec Retry-After`, async () => {
      // Nettoie le compteur avant ET après (finally) : fakeAuth renvoie toujours le même id ("test-user"),
      // partagé par tous les tests de ce fichier.
      await sharedValkey()?.del("phone-action-rate:test-user");
      try {
        for (let i = 0; i < PHONE_ACTION_RATE_LIMIT; i++) {
          const id = `it-rate-${i}-${Date.now()}`;
          await seed(session({ sessionId: id }));
          const res = await app.inject({ method: "POST", url: `/api/phone/${id}/action`, payload: { action: "confirm" } });
          assert.equal(res.statusCode, 200, `action ${i + 1}/${PHONE_ACTION_RATE_LIMIT}`);
        }
        const id = `it-rate-blocked-${Date.now()}`;
        await seed(session({ sessionId: id }));
        const blocked = await app.inject({ method: "POST", url: `/api/phone/${id}/action`, payload: { action: "confirm" } });
        assert.equal(blocked.statusCode, 429);
        assert.deepEqual(blocked.json(), { error: "too_many_requests", retryAfter: PHONE_ACTION_RATE_WINDOW_SEC });
        assert.equal(blocked.headers["retry-after"], String(PHONE_ACTION_RATE_WINDOW_SEC));

        // La session n'a pas été consommée par la tentative bloquée : elle reste "pending".
        const stored = JSON.parse((await admin.get(phoneSessionKey(id))) as string) as PhoneSession;
        assert.equal(stored.status, "pending");
      } finally {
        await sharedValkey()?.del("phone-action-rate:test-user");
      }
    });
  },
);

describe(
  "exceedsPhoneActionRateLimit — limite de débit par compte (avec un vrai Valkey, TEST_VALKEY_URL)",
  { skip: !process.env.TEST_VALKEY_URL },
  () => {
    const url = process.env.TEST_VALKEY_URL as string;
    let app: FastifyInstance;

    before(async () => {
      app = Fastify({ logger: false });
      registerValkey(app, { VALKEY_URL: url });
      await waitFor(() => sharedValkey()?.status === "ready");
    });

    // Sans ce after(), le client Valkey partagé (ouvert par registerValkey ci-dessus) resterait connecté :
    // le processus de test ne se termine jamais (socket ouvert = boucle d'événements jamais vide).
    after(async () => {
      await app.close();
    });

    it(`autorise jusqu'à ${PHONE_ACTION_RATE_LIMIT} actions par fenêtre, refuse la suivante`, async () => {
      const userId = `rate-test-${randomUUID()}`;
      for (let i = 0; i < PHONE_ACTION_RATE_LIMIT; i++) {
        assert.equal(await exceedsPhoneActionRateLimit(userId), false, `action ${i + 1}/${PHONE_ACTION_RATE_LIMIT}`);
      }
      assert.equal(await exceedsPhoneActionRateLimit(userId), true, "la suivante dépasse la limite");
    });

    it("deux comptes ont des compteurs indépendants", async () => {
      const a = `rate-test-${randomUUID()}`;
      const b = `rate-test-${randomUUID()}`;
      for (let i = 0; i < PHONE_ACTION_RATE_LIMIT; i++) await exceedsPhoneActionRateLimit(a);
      assert.equal(await exceedsPhoneActionRateLimit(a), true, "a est épuisé");
      assert.equal(await exceedsPhoneActionRateLimit(b), false, "b, un autre compte, n'est pas affecté");
    });
  },
);

async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("condition jamais remplie");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
