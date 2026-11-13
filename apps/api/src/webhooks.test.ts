import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import Fastify from "fastify";
import type { AuthenticatedUser } from "./auth.js";
import { DELIVERIES_LIMIT, registerWebhookDeliveryRoutes, type WebhookDeliveryView } from "./webhooks.js";

const ALICE: AuthenticatedUser = { id: randomUUID(), email: "alice@exemple.test", name: "Alice" };
const BOB: AuthenticatedUser = { id: randomUUID(), email: "bob@exemple.test", name: "Bob" };
const ALICE_PROJECT = randomUUID();

const row = (over: Partial<WebhookDeliveryView> = {}): WebhookDeliveryView => ({
  id: "42",
  deliveryId: randomUUID(),
  requestId: randomUUID(),
  event: "checkout.completed",
  attempt: 1,
  outcome: "success",
  statusCode: 200,
  durationMs: 12,
  destinationHost: "hooks.exemple.test",
  createdAt: "2026-11-13T10:00:00.000Z",
  ...over,
});

async function buildApp(user: AuthenticatedUser | null, rows: WebhookDeliveryView[] = []) {
  const calls: { projectId: string; limit: number }[] = [];
  const app = Fastify({ logger: false });
  registerWebhookDeliveryRoutes(app, {
    requireUser: async () => user,
    assertProjectOwner: async (u, projectId) => u.id === ALICE.id && projectId === ALICE_PROJECT,
    list: async (projectId, limit) => {
      calls.push({ projectId, limit });
      return rows;
    },
  });
  return { app, calls };
}

describe("GET /api/projects/:id/webhook-deliveries", () => {
  it("sans session → 401, sans lecture de la base", async () => {
    const { app, calls } = await buildApp(null);
    const res = await app.inject({ method: "GET", url: `/api/projects/${ALICE_PROJECT}/webhook-deliveries` });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error, "unauthenticated");
    assert.equal(calls.length, 0);
  });

  it("projet d'un autre utilisateur (ou inexistant, ou id mal formé) → 404, sans lecture de la base", async () => {
    const { app, calls } = await buildApp(BOB);
    for (const id of [ALICE_PROJECT, randomUUID(), "pas-un-uuid"]) {
      const res = await app.inject({ method: "GET", url: `/api/projects/${id}/webhook-deliveries` });
      assert.equal(res.statusCode, 404, id);
      assert.equal(res.json().error, "project_not_found");
    }
    assert.equal(calls.length, 0);
  });

  it("propriétaire → 200 avec les dernières tentatives (50 au plus)", async () => {
    const rows = [
      row({ id: "43", attempt: 2, outcome: "success", statusCode: 200 }),
      row({ id: "42", attempt: 1, outcome: "network_error", statusCode: null }),
      row({ id: "41", outcome: "no_url", statusCode: null, destinationHost: null, durationMs: 0 }),
    ];
    const { app, calls } = await buildApp(ALICE, rows);
    const res = await app.inject({ method: "GET", url: `/api/projects/${ALICE_PROJECT}/webhook-deliveries` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.deepEqual(res.json(), { deliveries: rows });
    assert.deepEqual(calls, [{ projectId: ALICE_PROJECT, limit: DELIVERIES_LIMIT }]);
    assert.equal(DELIVERIES_LIMIT, 50);
  });

  it("propriétaire sans aucun envoi → 200 avec une liste vide", async () => {
    const { app } = await buildApp(ALICE, []);
    const res = await app.inject({ method: "GET", url: `/api/projects/${ALICE_PROJECT}/webhook-deliveries` });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { deliveries: [] });
  });
});
