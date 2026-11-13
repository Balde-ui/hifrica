// Tests C6 : récepteur des webhooks de la boutique de démo. Dépendances injectées (secret, stockage,
// session), signatures réelles produites par la fonction partagée @hifrica/shared/webhook-signature.
// Le script Lua lui-même ne peut être exécuté qu'avec un vrai Valkey (test séparé, non inclus ici).
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { encryptWebhookSecret, parseWebhookSecretKeyring } from "@hifrica/db";
import { signWebhook } from "@hifrica/shared/webhook-signature";
import type { AuthenticatedUser } from "./auth.js";
import {
  createSecretLoader,
  createValkeyDemoStore,
  DEDUP_AND_STORE_SCRIPT,
  DEMO_BODY_LIMIT,
  DEMO_CONFIRMATIONS_LIMIT,
  DEMO_TTL_SEC,
  demoKeys,
  parseStoredConfirmation,
  registerDemoWebhooks,
  visibleConfirmations,
  type DemoConfirmation,
  type DemoConfirmationStore,
  type SecretLookup,
} from "./demo-webhooks.js";

const PROJECT_A = randomUUID();
const PROJECT_B = randomUUID();
const SECRETS: Record<string, string> = { [PROJECT_A]: "whsec_secret-du-projet-A-0123456789", [PROJECT_B]: "whsec_secret-du-projet-B-9876543210" };
const NOW = 1_800_000_000;
const OWNER: AuthenticatedUser = { id: "user-a", email: "a@example.test", name: "A" };
const OTHER: AuthenticatedUser = { id: "user-b", email: "b@example.test", name: "B" };

/** Stockage en mémoire, même sémantique que le script Lua : rien si l'envoi OU le paiement est connu. */
class MemoryStore implements DemoConfirmationStore {
  lists = new Map<string, DemoConfirmation[]>();
  seen = new Set<string>();
  failing = false;
  async add(projectId: string, entry: DemoConfirmation): Promise<boolean> {
    if (this.failing) throw new Error("valkey_not_ready (wait)");
    const k = demoKeys(projectId, entry.paymentId, entry.deliveryId);
    if (this.seen.has(k.payment) || this.seen.has(k.delivery)) return false;
    this.seen.add(k.payment);
    this.seen.add(k.delivery);
    const list = [entry, ...(this.lists.get(projectId) ?? [])].slice(0, DEMO_CONFIRMATIONS_LIMIT);
    this.lists.set(projectId, list);
    return true;
  }
  async list(projectId: string, limit: number): Promise<DemoConfirmation[]> {
    if (this.failing) throw new Error("valkey_not_ready (wait)");
    return (this.lists.get(projectId) ?? []).slice(0, limit);
  }
}

interface Setup {
  app: FastifyInstance;
  store: MemoryStore;
  secretCalls: string[];
  logs: string[];
}

async function setup(overrides: { loadSecret?: (id: string) => Promise<SecretLookup>; user?: AuthenticatedUser | null; store?: DemoConfirmationStore } = {}): Promise<Setup> {
  const logs: string[] = [];
  const stream = { write: (line: string) => void logs.push(line) };
  const app = Fastify({ logger: { level: "info", stream } });
  const store = new MemoryStore();
  const secretCalls: string[] = [];
  // Route voisine : le parseur JSON global ne doit pas être affecté par le plugin.
  app.post("/api/autre", async (req) => ({ type: typeof req.body, body: req.body }));
  registerDemoWebhooks(app, {
    loadSecret:
      overrides.loadSecret ??
      (async (id) => {
        secretCalls.push(id);
        return SECRETS[id] ? { status: "ok", secret: SECRETS[id] } : { status: "not_found" };
      }),
    store: overrides.store ?? store,
    requireUser: async () => (overrides.user === undefined ? OWNER : overrides.user),
    assertProjectOwner: async (user, projectId) => user.id === OWNER.id && projectId === PROJECT_A,
    nowSec: () => NOW,
  });
  await app.ready();
  return { app, store, secretCalls, logs };
}

function envelope(over: { event?: string; deliveryId?: string; data?: Record<string, unknown> } = {}) {
  return JSON.stringify({
    id: over.deliveryId ?? randomUUID(),
    event: over.event ?? "checkout.completed",
    created_at: new Date(NOW * 1000).toISOString(),
    data: over.data ?? { id: "chk_7f3a9c", status: "succeeded", amount: 24000, currency: "XOF" },
  });
}

function post(app: FastifyInstance, projectId: string, rawBody: string, opts: { secret?: string; t?: number; headers?: Record<string, string>; contentType?: string } = {}) {
  const secret = opts.secret ?? SECRETS[projectId] ?? "inconnu";
  return app.inject({
    method: "POST",
    url: `/api/demo/webhooks/${projectId}`,
    headers: {
      "content-type": opts.contentType ?? "application/json",
      "x-hifrica-signature": signWebhook(secret, opts.t ?? NOW, rawBody),
      "x-hifrica-event": "checkout.completed",
      "x-hifrica-request-id": "6f1c1f8e-2a9b-4d2e-9a51-0c3b8d0e1a77",
      ...opts.headers,
    },
    payload: rawBody,
  });
}

function assertNoLeak(text: string) {
  for (const secret of Object.values(SECRETS)) assert.ok(!text.includes(secret), "le secret ne doit jamais apparaître");
  assert.ok(!/WEBHOOK_SECRET_KEYS|déchiffrement|Clé de déchiffrement|v9:|v1:/.test(text), `aucun détail de déchiffrement : ${text.slice(0, 200)}`);
}

describe("C6 : POST /api/demo/webhooks/:projectId", () => {
  it("signature valide sur le corps brut exact → 200, confirmation stockée depuis le corps signé", async () => {
    const { app, store } = await setup();
    // Corps volontairement non canonique (espaces, accents) : la signature porte sur ces octets exacts.
    const deliveryId = randomUUID();
    const raw = `{ "id": "${deliveryId}",  "event" : "checkout.completed", "created_at": "2027-01-15T08:00:00.000Z",\n "data": {"id":"chk_e_1","status":"succeeded","amount":24000,"currency":"XOF","note":"Café Touba"} }`;
    const res = await post(app, PROJECT_A, raw);
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { received: true, duplicate: false });
    const [entry] = store.lists.get(PROJECT_A) ?? [];
    assert.equal(entry.paymentId, "chk_e_1", "paymentId = data.id (signé), pas body.id");
    assert.equal(entry.deliveryId, deliveryId, "deliveryId = id de l'enveloppe signée");
    assert.equal(entry.amount, 24000);
    assert.equal(entry.currency, "XOF");
    assert.equal(entry.requestId, "6f1c1f8e-2a9b-4d2e-9a51-0c3b8d0e1a77");
    assert.equal(entry.receivedAt, new Date(NOW * 1000).toISOString());
  });

  it("le même corps re-signé (relance du moteur, nouveau t) → 200 duplicate, une seule entrée", async () => {
    const { app, store } = await setup();
    const raw = envelope();
    assert.equal((await post(app, PROJECT_A, raw, { t: NOW - 100 })).json().duplicate, false);
    const retry = await post(app, PROJECT_A, raw, { t: NOW });
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.json().duplicate, true);
    assert.equal(store.lists.get(PROJECT_A)?.length, 1);
  });

  it("même paiement, nouvel identifiant d'envoi → 200 duplicate, aucune deuxième confirmation", async () => {
    const { app, store } = await setup();
    await post(app, PROJECT_A, envelope());
    const again = await post(app, PROJECT_A, envelope());
    assert.equal(again.json().duplicate, true);
    assert.equal(store.lists.get(PROJECT_A)?.length, 1);
  });

  it("signature avec un mauvais secret → 401, rien stocké", async () => {
    const { app, store } = await setup();
    const res = await post(app, PROJECT_A, envelope(), { secret: "pas-le-bon-secret" });
    assert.equal(res.statusCode, 401);
    assert.equal(store.lists.size, 0);
  });

  it("corps altéré après signature → 401", async () => {
    const { app, store } = await setup();
    const raw = envelope();
    const res = await app.inject({
      method: "POST",
      url: `/api/demo/webhooks/${PROJECT_A}`,
      headers: { "content-type": "application/json", "x-hifrica-signature": signWebhook(SECRETS[PROJECT_A], NOW, raw) },
      payload: raw.replace("24000", "24001"),
    });
    assert.equal(res.statusCode, 401);
    assert.equal(store.lists.size, 0);
  });

  it("le même JSON re-sérialisé autrement (espaces) ne passe pas : la vérification porte sur les octets bruts", async () => {
    const { app } = await setup();
    const raw = envelope();
    const res = await app.inject({
      method: "POST",
      url: `/api/demo/webhooks/${PROJECT_A}`,
      headers: { "content-type": "application/json", "x-hifrica-signature": signWebhook(SECRETS[PROJECT_A], NOW, raw) },
      payload: JSON.stringify(JSON.parse(raw), null, 2),
    });
    assert.equal(res.statusCode, 401);
  });

  it("signature expirée (t vieux de 301 s) → 401 ; à 300 s → acceptée", async () => {
    const { app } = await setup();
    assert.equal((await post(app, PROJECT_A, envelope(), { t: NOW - 301 })).statusCode, 401);
    assert.equal((await post(app, PROJECT_A, envelope(), { t: NOW - 300 })).statusCode, 200);
  });

  it("en-tête de signature absent ou mal formé → 401 sans lire le secret (aucune requête SQL)", async () => {
    const { app, secretCalls } = await setup();
    const raw = envelope();
    for (const sig of [undefined, "", "t=abc,v1=00", "v1=" + "a".repeat(64), "t=1800000000"]) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (sig !== undefined) headers["x-hifrica-signature"] = sig;
      const res = await app.inject({ method: "POST", url: `/api/demo/webhooks/${PROJECT_A}`, headers, payload: raw });
      assert.equal(res.statusCode, 401, `en-tête ${JSON.stringify(sig)}`);
    }
    assert.equal(secretCalls.length, 0);
  });

  it("identifiant de projet mal formé → 404 sans lire le secret ; projet inconnu → 404", async () => {
    const { app, secretCalls } = await setup();
    const bad = await post(app, "pas-un-uuid", envelope(), { secret: "x" });
    assert.equal(bad.statusCode, 404);
    assert.equal(secretCalls.length, 0);
    const unknown = randomUUID();
    const res = await post(app, unknown, envelope(), { secret: "x" });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json(), { error: "not_found" });
  });

  it("projet croisé : webhook signé avec le secret du projet B envoyé à l'URL du projet A → 401", async () => {
    const { app, store } = await setup();
    const res = await post(app, PROJECT_A, envelope(), { secret: SECRETS[PROJECT_B] });
    assert.equal(res.statusCode, 401);
    assert.equal(store.lists.size, 0);
  });

  it("Content-Type non JSON → 415 (text/plain, formulaire), sans lire le secret", async () => {
    const { app, secretCalls } = await setup();
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "application/xml"]) {
      const res = await post(app, PROJECT_A, envelope(), { contentType: ct });
      assert.equal(res.statusCode, 415, `${ct} : ${res.body}`);
    }
    assert.equal(secretCalls.length, 0);
    assert.equal((await post(app, PROJECT_A, envelope(), { contentType: "application/json; charset=utf-8" })).statusCode, 200);
  });

  it("corps de plus de 64 Ko → 413 (et non 500, qui ferait relancer le moteur)", async () => {
    const { app } = await setup();
    const big = envelope({ data: { id: "chk_big", status: "succeeded", amount: 1, currency: "XOF", pad: "x".repeat(DEMO_BODY_LIMIT) } });
    const res = await post(app, PROJECT_A, big);
    assert.equal(res.statusCode, 413);
    assert.equal(res.json().error, "body_too_large");
  });

  it("JSON invalide mais correctement signé → 400", async () => {
    const { app } = await setup();
    assert.equal((await post(app, PROJECT_A, "{pas du json")).statusCode, 400);
    assert.equal((await post(app, PROJECT_A, "[1,2,3]")).statusCode, 400);
  });

  it("champs signés invalides → 400 (id d'envoi, data.id, montant, devise)", async () => {
    const { app, store } = await setup();
    const cases = [
      envelope({ deliveryId: "pas-un-uuid" }),
      envelope({ data: { status: "succeeded", amount: 1 } }),
      envelope({ data: { id: "a b", status: "succeeded", amount: 1 } }),
      envelope({ data: { id: "chk", status: "succeeded", amount: "beaucoup" } }),
      envelope({ data: { id: "chk", status: "succeeded", amount: -5 } }),
      envelope({ data: { id: "chk", status: "succeeded", amount: 1, currency: "<script>" } }),
      JSON.stringify({ id: randomUUID(), event: "checkout.completed", data: "texte" }),
    ];
    for (const raw of cases) assert.equal((await post(app, PROJECT_A, raw)).statusCode, 400, raw);
    assert.equal(store.lists.size, 0);
  });

  it("événement signé non pris en charge → 200 ignored ; l'en-tête X-Hifrica-Event n'est pas pris en compte", async () => {
    const { app, store } = await setup();
    const res = await post(app, PROJECT_A, envelope({ event: "checkout.failed" }), { headers: { "x-hifrica-event": "checkout.completed" } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { received: true, ignored: true });
    assert.equal(store.lists.size, 0);
  });

  it("statut signé différent de succeeded → 200 ignored, aucune confirmation", async () => {
    const { app, store } = await setup();
    const res = await post(app, PROJECT_A, envelope({ data: { id: "chk_1", status: "failed", amount: 1, currency: "XOF" } }));
    assert.deepEqual(res.json(), { received: true, ignored: true });
    assert.equal(store.lists.size, 0);
  });

  it("X-Hifrica-Request-Id non UUID → requestId null (en-tête non signé, traçabilité seulement)", async () => {
    const { app, store } = await setup();
    await post(app, PROJECT_A, envelope(), { headers: { "x-hifrica-request-id": "<img src=x>" } });
    assert.equal(store.lists.get(PROJECT_A)?.[0].requestId, null);
  });

  it("secret indisponible (keyring absent ou déchiffrement impossible) → 503 générique, aucune fuite", async () => {
    const { app, logs } = await setup({ loadSecret: async () => ({ status: "unavailable" }) });
    const res = await post(app, PROJECT_A, envelope());
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error, "unavailable");
    assertNoLeak(res.body);
    assertNoLeak(logs.join("\n"));
  });

  it("stockage indisponible (Valkey) → 503 pour que le moteur relance", async () => {
    const store = new MemoryStore();
    store.failing = true;
    const { app } = await setup({ store });
    const res = await post(app, PROJECT_A, envelope());
    assert.equal(res.statusCode, 503);
  });

  it("stockage Valkey par défaut sans VALKEY_URL → 503 (runCommand : valkey_not_configured)", async () => {
    const app = Fastify({ logger: false });
    registerDemoWebhooks(app, { loadSecret: async () => ({ status: "ok", secret: SECRETS[PROJECT_A] }), nowSec: () => NOW });
    await app.ready();
    const raw = envelope();
    const res = await app.inject({
      method: "POST",
      url: `/api/demo/webhooks/${PROJECT_A}`,
      headers: { "content-type": "application/json", "x-hifrica-signature": signWebhook(SECRETS[PROJECT_A], NOW, raw) },
      payload: raw,
    });
    assert.equal(res.statusCode, 503);
  });

  it("aucune réponse d'erreur ne contient le secret", async () => {
    const { app } = await setup();
    const responses = [
      await post(app, PROJECT_A, envelope(), { secret: SECRETS[PROJECT_B] }),
      await post(app, PROJECT_A, "{pas du json"),
      await post(app, randomUUID(), envelope(), { secret: "x" }),
      await post(app, PROJECT_A, envelope(), { contentType: "text/plain" }),
    ];
    for (const r of responses) assertNoLeak(r.body);
  });

  it("le parseur JSON global des autres routes n'est pas affecté", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/autre", headers: { "content-type": "application/json" }, payload: '{"a":1}' });
    assert.deepEqual(res.json(), { type: "object", body: { a: 1 } });
  });
});

describe("C6 : GET /api/projects/:id/demo/webhooks", () => {
  it("sans session → 401", async () => {
    const { app } = await setup({ user: null });
    const res = await app.inject({ method: "GET", url: `/api/projects/${PROJECT_A}/demo/webhooks` });
    assert.equal(res.statusCode, 401);
  });

  it("utilisateur non propriétaire → 404", async () => {
    const { app } = await setup({ user: OTHER });
    const res = await app.inject({ method: "GET", url: `/api/projects/${PROJECT_A}/demo/webhooks` });
    assert.equal(res.statusCode, 404);
  });

  it("propriétaire → 200, no-store, confirmations vérifiées sans secret ni corps brut", async () => {
    const { app } = await setup();
    await post(app, PROJECT_A, envelope());
    const res = await app.inject({ method: "GET", url: `/api/projects/${PROJECT_A}/demo/webhooks` });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["cache-control"] as string, /no-store/);
    const { confirmations } = res.json() as { confirmations: DemoConfirmation[] };
    assert.equal(confirmations.length, 1);
    assert.deepEqual(Object.keys(confirmations[0]).sort(), ["amount", "currency", "deliveryId", "event", "paymentId", "receivedAt", "requestId", "status"]);
    assertNoLeak(res.body);
    assert.ok(!res.body.includes("created_at"), "pas de corps brut");
  });

  it("isolation : les confirmations du projet B ne sont jamais renvoyées pour A", async () => {
    const { app, store } = await setup();
    await post(app, PROJECT_B, envelope({ data: { id: "chk_de_B", status: "succeeded", amount: 1, currency: "XOF" } }));
    assert.equal(store.lists.get(PROJECT_B)?.length, 1);
    const res = await app.inject({ method: "GET", url: `/api/projects/${PROJECT_A}/demo/webhooks` });
    assert.deepEqual(res.json(), { confirmations: [] });
  });

  it("au plus 20 confirmations, les plus récentes d'abord", async () => {
    const { app } = await setup();
    for (let i = 0; i < DEMO_CONFIRMATIONS_LIMIT + 5; i++) {
      await post(app, PROJECT_A, envelope({ data: { id: `chk_${i}`, status: "succeeded", amount: i, currency: "XOF" } }));
    }
    const { confirmations } = (await app.inject({ method: "GET", url: `/api/projects/${PROJECT_A}/demo/webhooks` })).json() as { confirmations: DemoConfirmation[] };
    assert.equal(confirmations.length, DEMO_CONFIRMATIONS_LIMIT);
    assert.equal(confirmations[0].paymentId, `chk_${DEMO_CONFIRMATIONS_LIMIT + 4}`);
  });

  it("stockage indisponible → 503", async () => {
    const store = new MemoryStore();
    store.failing = true;
    const { app } = await setup({ store });
    const res = await app.inject({ method: "GET", url: `/api/projects/${PROJECT_A}/demo/webhooks` });
    assert.equal(res.statusCode, 503);
  });

  it("chaque confirmation disparaît 24 h après sa réception, même si d'autres arrivent ensuite (pas d'expiration glissante)", async () => {
    let clock = NOW;
    const store = new MemoryStore();
    const app = Fastify({ logger: false });
    registerDemoWebhooks(app, {
      loadSecret: async (id) => (SECRETS[id] ? { status: "ok", secret: SECRETS[id] } : { status: "not_found" }),
      store,
      requireUser: async () => OWNER,
      assertProjectOwner: async (_u, id) => id === PROJECT_A,
      nowSec: () => clock,
    });
    await app.ready();
    const send = (paymentId: string) => {
      const raw = envelope({ data: { id: paymentId, status: "succeeded", amount: 1, currency: "XOF" } });
      return app.inject({ method: "POST", url: `/api/demo/webhooks/${PROJECT_A}`, headers: { "content-type": "application/json", "x-hifrica-signature": signWebhook(SECRETS[PROJECT_A], clock, raw) }, payload: raw });
    };
    const visible = async () =>
      ((await app.inject({ method: "GET", url: `/api/projects/${PROJECT_A}/demo/webhooks` })).json() as { confirmations: DemoConfirmation[] }).confirmations.map((c) => c.paymentId);
    await send("chk_ancien");
    clock += 12 * 3600;
    await send("chk_recent"); // un ajout récent ne prolonge pas la visibilité de l'ancien
    clock = NOW + DEMO_TTL_SEC - 1;
    assert.deepEqual(await visible(), ["chk_recent", "chk_ancien"], "23 h 59 min 59 s : encore visible");
    clock = NOW + DEMO_TTL_SEC;
    assert.deepEqual(await visible(), ["chk_recent"], "24 h pile : l'ancienne n'est plus visible");
    clock = NOW + 12 * 3600 + DEMO_TTL_SEC;
    assert.deepEqual(await visible(), [], "24 h après la récente : plus rien");
  });

  it("état incohérent du script (confirmation écrite deux fois, marqueur manquant) : une seule confirmation visible", async () => {
    const entry = { paymentId: "chk_x", event: "checkout.completed", status: "succeeded", amount: 1, currency: "XOF", requestId: null, deliveryId: randomUUID(), receivedAt: new Date(NOW * 1000).toISOString() };
    const raw = [JSON.stringify(entry), JSON.stringify({ ...entry, receivedAt: new Date((NOW - 5) * 1000).toISOString() })];
    const store = createValkeyDemoStore(async (fn) => fn({ lrange: async () => raw } as never));
    const { app } = await setup({ store });
    const res = await app.inject({ method: "GET", url: `/api/projects/${PROJECT_A}/demo/webhooks` });
    assert.equal(res.statusCode, 200);
    assert.equal((res.json() as { confirmations: DemoConfirmation[] }).confirmations.length, 1);
  });
});

describe("C6 : visibilité des confirmations (lecture)", () => {
  const base = (over: Partial<DemoConfirmation>): DemoConfirmation => ({ paymentId: "p", event: "checkout.completed", status: "succeeded", amount: 1, currency: "XOF", requestId: null, deliveryId: randomUUID(), receivedAt: new Date(NOW * 1000).toISOString(), ...over });
  const at = (sec: number) => new Date(sec * 1000).toISOString();

  it("limite stricte de 24 h : visible à 24 h - 1 s, masquée à 24 h pile et au-delà", () => {
    const list = [base({ paymentId: "a", receivedAt: at(NOW - DEMO_TTL_SEC + 1) }), base({ paymentId: "b", receivedAt: at(NOW - DEMO_TTL_SEC) }), base({ paymentId: "c", receivedAt: at(NOW - DEMO_TTL_SEC - 3600) })];
    assert.deepEqual(visibleConfirmations(list, NOW).map((c) => c.paymentId), ["a"]);
  });

  it("date de réception illisible → masquée", () => {
    assert.equal(visibleConfirmations([base({ receivedAt: "pas une date" })], NOW).length, 0);
  });

  it("doublon par paiement ou par envoi → seule la première (la plus récente) est gardée", () => {
    const d = randomUUID();
    const list = [base({ paymentId: "p1", deliveryId: d }), base({ paymentId: "p1" }), base({ paymentId: "p2", deliveryId: d }), base({ paymentId: "p3" })];
    assert.deepEqual(visibleConfirmations(list, NOW).map((c) => c.paymentId), ["p1", "p3"]);
  });

  it("au plus 20, dans l'ordre reçu (les plus récentes d'abord)", () => {
    const list = Array.from({ length: 30 }, (_, i) => base({ paymentId: `p${i}` }));
    const out = visibleConfirmations(list, NOW);
    assert.equal(out.length, DEMO_CONFIRMATIONS_LIMIT);
    assert.equal(out[0].paymentId, "p0");
  });
});

describe("C6 : secret du projet (vrai chiffrement @hifrica/db)", () => {
  const key = (id: string) => `${id}:${randomBytes(32).toString("base64")}`;
  const keyring = parseWebhookSecretKeyring(key("v1"));

  it("déchiffre le secret du projet demandé", async () => {
    const enc = encryptWebhookSecret("whsec_reel", PROJECT_A, keyring);
    const load = createSecretLoader(async (id) => (id === PROJECT_A ? enc : null), keyring);
    assert.deepEqual(await load(PROJECT_A), { status: "ok", secret: "whsec_reel" });
    assert.deepEqual(await load(PROJECT_B), { status: "not_found" });
  });

  it("keyring absent → unavailable", async () => {
    const load = createSecretLoader(async () => "v1:a.b", null);
    assert.deepEqual(await load(PROJECT_A), { status: "unavailable" });
  });

  it("clé de déchiffrement absente du keyring, ou secret copié d'un autre projet (AAD) → unavailable, sans message", async () => {
    const enc = encryptWebhookSecret("whsec_reel", PROJECT_A, keyring);
    const otherKeyring = parseWebhookSecretKeyring(key("v9"));
    assert.deepEqual(await createSecretLoader(async () => enc, otherKeyring)(PROJECT_A), { status: "unavailable" });
    assert.deepEqual(await createSecretLoader(async () => enc, keyring)(PROJECT_B), { status: "unavailable" });
  });
});

describe("C6 : stockage Valkey (client simulé ; le script Lua lui-même exige un vrai Valkey)", () => {
  it("appelle EVAL avec le script atomique, 3 clés du projet, 24 h et l'index 19", async () => {
    const calls: unknown[][] = [];
    const fakeClient = { eval: async (...args: unknown[]) => (calls.push(args), 1), lrange: async () => [] };
    const store = createValkeyDemoStore(async (fn) => fn(fakeClient as never));
    const entry: DemoConfirmation = { paymentId: "chk_1", event: "checkout.completed", status: "succeeded", amount: 1, currency: "XOF", requestId: null, deliveryId: randomUUID(), receivedAt: "2027-01-15T08:00:00.000Z" };
    assert.equal(await store.add(PROJECT_A, entry), true);
    const [script, numKeys, k1, k2, k3, json, ttl, lastIndex] = calls[0];
    assert.equal(script, DEDUP_AND_STORE_SCRIPT);
    assert.equal(numKeys, 3);
    assert.equal(k1, `demo-webhook:paid:${PROJECT_A}:chk_1`);
    assert.equal(k2, `demo-webhook:delivery:${PROJECT_A}:${entry.deliveryId}`);
    assert.equal(k3, `demo-webhooks:${PROJECT_A}`);
    assert.deepEqual(JSON.parse(json as string), entry);
    assert.equal(ttl, String(DEMO_TTL_SEC));
    assert.equal(lastIndex, String(DEMO_CONFIRMATIONS_LIMIT - 1));
  });

  it("résultat 0 du script → doublon (false)", async () => {
    const store = createValkeyDemoStore(async (fn) => fn({ eval: async () => 0 } as never));
    const entry = { paymentId: "chk", event: "checkout.completed", status: "succeeded", amount: 1, currency: null, requestId: null, deliveryId: randomUUID(), receivedAt: "x" } as DemoConfirmation;
    assert.equal(await store.add(PROJECT_A, entry), false);
  });

  it("ordre du script : marqueurs lus, type de la liste vérifié, confirmation écrite, marqueurs écrits EN DERNIER", () => {
    // Analyse du texte du script : son exécution réelle exige un vrai Valkey.
    const at = (needle: string) => {
      const i = DEDUP_AND_STORE_SCRIPT.indexOf(needle);
      assert.ok(i >= 0, `absent du script : ${needle}`);
      return i;
    };
    const writes = ["'LPUSH'", "'LTRIM'", "'EXPIRE'", "'SET', KEYS[2]", "'SET', KEYS[1]"].map(at);
    const firstWrite = Math.min(...writes);
    assert.ok(at("'EXISTS', KEYS[1]") < firstWrite && at("'EXISTS', KEYS[2]") < firstWrite, "déduplication avant toute écriture");
    assert.ok(at("'TYPE', KEYS[3]") < firstWrite && at("error_reply") < firstWrite, "type vérifié avant toute écriture");
    assert.deepEqual([...writes].sort((a, b) => a - b), writes, "ordre : LPUSH, LTRIM, EXPIRE, puis les deux SET");
    assert.ok(at("'SET', KEYS[1]") > at("'LPUSH'"), "aucun marqueur avant la confirmation");
    assert.ok(!/\bDEL\b|FLUSH|KEYS\s*\(/.test(DEDUP_AND_STORE_SCRIPT), "aucune commande destructive");
  });

  it("lecture : entrées illisibles ignorées, champs normalisés", async () => {
    const good = JSON.stringify({ paymentId: "chk", deliveryId: "d", receivedAt: "r", amount: 5, currency: "XOF", requestId: "pas-uuid", secret: "fuite" });
    const store = createValkeyDemoStore(async (fn) => fn({ lrange: async () => ["{cassé", good, "{}"] } as never));
    const list = await store.list(PROJECT_A, 20);
    assert.equal(list.length, 1);
    assert.equal(list[0].requestId, null);
    assert.ok(!("secret" in list[0]), "aucun champ inattendu renvoyé");
    assert.equal(parseStoredConfirmation("null"), null);
  });

  it("erreur de runCommand propagée (la route répond alors 503)", async () => {
    const store = createValkeyDemoStore(async () => {
      throw new Error("valkey_timeout");
    });
    await assert.rejects(store.list(PROJECT_A, 20), /valkey_timeout/);
  });
});
