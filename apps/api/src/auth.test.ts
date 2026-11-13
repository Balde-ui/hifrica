// Tests de la validation serveur du nom (inscription et mise à jour du profil), appliquée par l'adaptateur
// Fastify de C avant Better Auth. Better Auth est remplacé par un gestionnaire factice qui enregistre ce qu'il
// reçoit : on vérifie qu'une requête refusée ne l'atteint jamais, et qu'une requête valide passe inchangée.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { checkDisplayName, NAME_MAX_LENGTH, registerAuthRoutes, type Auth } from "./auth.js";

const BASE = "http://localhost:3000";

async function setup() {
  const received: { path: string; body: unknown }[] = [];
  const fakeAuth = {
    handler: async (request: Request) => {
      const text = await request.text();
      received.push({ path: new URL(request.url).pathname, body: text ? JSON.parse(text) : null });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    },
  } as unknown as Auth;
  const app = Fastify({ logger: false });
  registerAuthRoutes(app, fakeAuth, BASE);
  await app.ready();
  const post = (path: string, body: unknown) =>
    app.inject({ method: "POST", url: path, headers: { "content-type": "application/json", origin: BASE }, payload: JSON.stringify(body) });
  return { app, received, post };
}

describe("checkDisplayName", () => {
  it("accepte de 1 à 80 caractères (espaces de bord ignorés)", () => {
    assert.deepEqual(checkDisplayName("A"), { ok: true });
    assert.deepEqual(checkDisplayName("Aminata Diallo"), { ok: true });
    assert.deepEqual(checkDisplayName("x".repeat(NAME_MAX_LENGTH)), { ok: true });
    assert.deepEqual(checkDisplayName(`  ${"x".repeat(NAME_MAX_LENGTH)}  `), { ok: true });
  });

  it("refuse un nom vide, fait d'espaces ou absent", () => {
    for (const v of ["", "   ", undefined, null, 42, {}]) assert.equal(checkDisplayName(v).ok, false, JSON.stringify(v));
    assert.deepEqual(checkDisplayName(""), { ok: false, code: "NAME_REQUIRED", message: "Nom requis." });
  });

  it("refuse plus de 80 caractères", () => {
    const r = checkDisplayName("x".repeat(NAME_MAX_LENGTH + 1));
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, "NAME_TOO_LONG");
  });

  it("compte les caractères Unicode, jamais plus strict que le maxLength du formulaire", () => {
    assert.deepEqual(checkDisplayName("é".repeat(NAME_MAX_LENGTH)), { ok: true });
    assert.deepEqual(checkDisplayName("😀".repeat(40)), { ok: true }); // 80 unités UTF-16 côté formulaire
  });
});

describe("POST /api/auth/sign-up/email : nom vérifié côté serveur", () => {
  it("nom valide → transmis à Better Auth tel quel", async () => {
    const { post, received } = await setup();
    const body = { name: "Aminata Diallo", email: "a@example.test", password: "motdepasse-solide-42" };
    const res = await post("/api/auth/sign-up/email", body);
    assert.equal(res.statusCode, 200);
    assert.equal(received.length, 1);
    assert.deepEqual(received[0], { path: "/api/auth/sign-up/email", body });
  });

  it("nom de 80 caractères → accepté ; 81 → 400 NAME_TOO_LONG, Better Auth jamais appelé", async () => {
    const { post, received } = await setup();
    assert.equal((await post("/api/auth/sign-up/email", { name: "x".repeat(80), email: "a@example.test", password: "p".repeat(8) })).statusCode, 200);
    const res = await post("/api/auth/sign-up/email", { name: "x".repeat(81), email: "b@example.test", password: "p".repeat(8) });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), { code: "NAME_TOO_LONG", message: "Nom trop long (80 caractères au plus)." });
    assert.equal(received.length, 1, "la requête refusée n'atteint pas Better Auth");
  });

  it("nom vide, fait d'espaces ou absent → 400 NAME_REQUIRED", async () => {
    const { post, received } = await setup();
    for (const body of [{ name: "", email: "a@example.test", password: "p".repeat(8) }, { name: "   ", email: "a@example.test", password: "p".repeat(8) }, { email: "a@example.test", password: "p".repeat(8) }]) {
      const res = await post("/api/auth/sign-up/email", body);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.equal(res.json().code, "NAME_REQUIRED");
    }
    assert.equal(received.length, 0);
  });

  it("nom très long (10 000 caractères) → 400 sans atteindre Better Auth", async () => {
    const { post, received } = await setup();
    const res = await post("/api/auth/sign-up/email", { name: "x".repeat(10_000), email: "a@example.test", password: "p".repeat(8) });
    assert.equal(res.statusCode, 400);
    assert.equal(received.length, 0);
  });
});

describe("POST /api/auth/update-user : nom vérifié s'il est fourni", () => {
  it("sans champ name → transmis (mise à jour d'autres champs)", async () => {
    const { post, received } = await setup();
    assert.equal((await post("/api/auth/update-user", { image: null })).statusCode, 200);
    assert.equal(received.length, 1);
  });

  it("name trop long ou vide → 400, non transmis", async () => {
    const { post, received } = await setup();
    assert.equal((await post("/api/auth/update-user", { name: "x".repeat(81) })).statusCode, 400);
    assert.equal((await post("/api/auth/update-user", { name: " " })).statusCode, 400);
    assert.equal(received.length, 0);
  });
});

describe("autres routes Better Auth : inchangées", () => {
  it("connexion (sans nom) et GET de session → transmises sans contrôle du nom", async () => {
    const { app, post, received } = await setup();
    assert.equal((await post("/api/auth/sign-in/email", { email: "a@example.test", password: "p".repeat(8) })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: "/api/auth/get-session" })).statusCode, 200);
    assert.deepEqual(received.map((r) => r.path), ["/api/auth/sign-in/email", "/api/auth/get-session"]);
  });
});
