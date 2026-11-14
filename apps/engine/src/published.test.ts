// Routes du moteur sur des simulateurs publiés depuis l'éditeur (base simulée, sans PostgreSQL ni Valkey).
// La clé sk_test_ passe par le bouchon local (pas de DATABASE_URL) : projet "demo".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { DbOperationError, type Database, type ExecutableSimulator } from "@hifrica/db";
import type { InjectOptions } from "fastify";
import { buildApp } from "./app.js";
import type { HifricaRequestContext } from "./context.js";
import { loadSimulators } from "./simulators.js";

const APP = "https://app.exemple.test";
const KEY = { authorization: `Bearer sk_test_${"b".repeat(43)}` };
const BROWSER = { accept: "text/html,application/xhtml+xml,*/*;q=0.8" };
const SIMULATORS_DIR = fileURLToPath(new URL("../../../simulators", import.meta.url));
const read = (file: string) => readFileSync(new URL(`../../../simulators/${file}`, import.meta.url), "utf8");
const HTTP_YAML = read("paiement-mobile-generique.yaml");
const USSD_YAML = read("mobile-money-ussd.yaml");

const rename = (yaml: string, slug: string, marker = "pending") =>
  yaml.replace(/^name: .+$/m, `name: ${slug}`).replace('status: "pending"', `status: "${marker}"`);
const row = (slug: string, over: Partial<ExecutableSimulator> = {}): ExecutableSimulator => ({
  slug,
  kind: "http",
  status: "draft",
  version: "1.0.0",
  yaml: rename(HTTP_YAML, slug),
  ...over,
});

function engine(rows: Record<string, ExecutableSimulator | Error> = {}, now?: () => number) {
  const reads: string[] = [];
  const logs: string[] = [];
  const contexts: (HifricaRequestContext | null)[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      logs.push(String(chunk));
      cb();
    },
  });
  const app = buildApp({
    simulators: loadSimulators(SIMULATORS_DIR, () => undefined),
    env: { APP_PUBLIC_URL: APP },
    logger: { level: "info", stream },
    catalog: {
      getDb: () => ({}) as Database,
      fetchPublished: async (_db, slug) => {
        reads.push(slug);
        const r = rows[slug];
        if (r instanceof Error) throw r;
        return r ?? null;
      },
      now,
    },
  });
  app.addHook("onResponse", async (req) => void contexts.push(req.hifrica));
  const call = async (opts: InjectOptions) => {
    const res = await app.inject(opts);
    return { res, hifrica: contexts.at(-1) };
  };
  const checkout = (slug: string, headers: Record<string, string> = KEY) =>
    call({ method: "POST", url: `/${slug}/v1/checkout`, headers: { ...headers, "content-type": "application/json" }, payload: { amount: 5000, merchant: "Boutique" } });
  return { app, call, checkout, reads, logs, rows };
}

describe("moteur : simulateurs publiés depuis l'éditeur", () => {
  it("le fichier simulators/ est prioritaire sur un simulateur publié du même slug", async () => {
    const e = engine({ "paiement-mobile-generique": row("paiement-mobile-generique", { yaml: rename(HTTP_YAML, "paiement-mobile-generique", "PUBLIE") }) });
    const { res } = await e.checkout("paiement-mobile-generique");
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().status, "pending", "réponse du fichier, pas de la version publiée");
    assert.deepEqual(e.reads, []);
    await e.app.close();
  });

  for (const status of ["draft", "to_verify", "verified"] as const) {
    it(`publié ${status} → 201, rattaché au projet de la clé`, async () => {
      const e = engine({ "boutique-qr": row("boutique-qr", { status, yaml: rename(HTTP_YAML, "boutique-qr", `publie-${status}`) }) });
      const { res, hifrica } = await e.checkout("boutique-qr");
      assert.equal(res.statusCode, 201);
      assert.equal(res.json().status, `publie-${status}`);
      assert.equal(res.json().amount, 5000);
      assert.equal(hifrica?.simulator, "boutique-qr");
      assert.equal(hifrica?.projectId, "demo");
      assert.equal(hifrica?.endpointId, "checkout");
      await e.app.close();
    });
  }

  // Revue C : aucune lecture en base sans clé bien formée (Bearer sk_test_ + 43 caractères base62).
  const MALFORMED: [string, Record<string, string>][] = [
    ["sans clé", {}],
    ["Authorization vide", { authorization: "" }],
    ["clé trop courte", { authorization: "Bearer sk_test_local" }],
    ["42 caractères", { authorization: `Bearer sk_test_${"c".repeat(42)}` }],
    ["44 caractères", { authorization: `Bearer sk_test_${"c".repeat(44)}` }],
    ["caractère hors base62", { authorization: `Bearer sk_test_${"c".repeat(42)}-` }],
    ["sk_live_", { authorization: `Bearer sk_live_${"c".repeat(43)}` }],
    ["« bearer » en minuscules", { authorization: `bearer sk_test_${"c".repeat(43)}` }],
    ["double espace", { authorization: `Bearer  sk_test_${"c".repeat(43)}` }],
    ["schéma Basic", { authorization: "Basic dXNlcjpwYXNz" }],
  ];
  for (const [label, headers] of MALFORMED) {
    it(`${label} → 401 invalid_test_key sans aucune lecture en base (slug publié ou inconnu, HTTP et USSD)`, async () => {
      const e = engine({ "boutique-qr": row("boutique-qr"), "ussd-boutique": row("ussd-boutique", { kind: "ussd", yaml: rename(USSD_YAML, "ussd-boutique") }) });
      for (const slug of ["boutique-qr", "jamais-publie"]) {
        const { res, hifrica } = await e.checkout(slug, headers);
        assert.equal(res.statusCode, 401, slug);
        assert.deepEqual(res.json(), { error: "invalid_test_key" });
        assert.equal(hifrica, null, "rien de journalisé");
        const get = await e.call({ method: "GET", url: `/${slug}/v1/checkout/x`, headers: { ...headers, accept: "application/json" } });
        assert.equal(get.res.statusCode, 401);
      }
      for (const slug of ["ussd-boutique", "ussd-inconnu"]) {
        const res = await e.call({ method: "POST", url: `/${slug}/ussd`, headers: { ...headers, "content-type": "application/json" }, payload: { text: "" } });
        assert.equal(res.res.statusCode, 401, slug);
        assert.deepEqual(res.res.json(), { error: "invalid_test_key" });
      }
      // /<slug> sans chemin, hors navigateur : le 404 de Fastify, sans lecture non plus.
      assert.equal((await e.call({ method: "GET", url: "/boutique-qr", headers })).res.statusCode, 404);
      assert.deepEqual(e.reads, [], "getExecutableSimulator jamais appelé");
      await e.app.close();
    });
  }

  it("clé bien formée → résolution (catalogue), puis authenticate comme avant", async () => {
    const e = engine({ "boutique-qr": row("boutique-qr") });
    assert.equal((await e.checkout("boutique-qr")).res.statusCode, 201);
    const unknown = await e.checkout("jamais-publie");
    assert.equal(unknown.res.statusCode, 404);
    assert.deepEqual(unknown.res.json(), { error: "simulator_not_found" });
    assert.deepEqual(e.reads, ["boutique-qr", "jamais-publie"]);
    await e.app.close();
  });

  it("fichiers simulators/ inchangés : 404 avant 401, 401 sans clé, sans lecture en base", async () => {
    const e = engine({ "mobile-money-ussd": row("mobile-money-ussd"), "paiement-mobile-generique": row("paiement-mobile-generique") });
    // Simulateur USSD (fichier) appelé en HTTP sans clé : 404 avant toute authentification, comme avant.
    const ussdViaHttp = await e.call({ method: "POST", url: "/mobile-money-ussd/v1/checkout", headers: { "content-type": "application/json" }, payload: {} });
    assert.equal(ussdViaHttp.res.statusCode, 404);
    assert.deepEqual(ussdViaHttp.res.json(), { error: "simulator_not_found" });
    // Fichier HTTP sans clé : 401 par authenticate, comme avant (le bouchon local, sans DATABASE_URL,
    // accepte tout « sk_test_… » : ce comportement des fichiers est lui aussi inchangé).
    for (const [, headers] of MALFORMED.slice(0, 2)) assert.equal((await e.checkout("paiement-mobile-generique", headers)).res.statusCode, 401);
    assert.equal((await e.checkout("paiement-mobile-generique", { authorization: "Bearer sk_test_local" })).res.statusCode, 201);
    // Avec clé : endpoint inconnu → 404 endpoint_not_found.
    const noEndpoint = await e.call({ method: "GET", url: "/paiement-mobile-generique/v1/inconnu", headers: KEY });
    assert.equal(noEndpoint.res.statusCode, 404);
    assert.equal(noEndpoint.res.json().error, "endpoint_not_found");
    assert.deepEqual(e.reads, []);
    await e.app.close();
  });

  it("dépublié (absent des statuts exécutables) → 404 simulator_not_found", async () => {
    const e = engine();
    const { res, hifrica } = await e.checkout("ancien-simulateur");
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json(), { error: "simulator_not_found" });
    assert.equal(hifrica, null);
    await e.app.close();
  });

  it("YAML invalide en base → 404 et log d'erreur (slug, version), YAML jamais journalisé", async () => {
    const e = engine({ "yaml-casse": row("yaml-casse", { version: "2.0.0", yaml: "name: yaml-casse\nkind: http\nendpoints: 3\nnote: secret-a-ne-pas-logger\n" }) });
    const { res } = await e.checkout("yaml-casse");
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json(), { error: "simulator_not_found" });
    const line = e.logs.find((l) => l.includes("simulateur publié invalide"));
    assert.ok(line, "log d'erreur");
    assert.match(line!, /"slug":"yaml-casse"/);
    assert.match(line!, /"version":"2.0.0"/);
    assert.ok(!e.logs.join("").includes("secret-a-ne-pas-logger"));
    await e.app.close();
  });

  it("base en erreur → 503 engine_unavailable (pas 404), rien de journalisé pour le projet", async () => {
    const e = engine({ "en-panne": new DbOperationError("get_executable_simulator", "connection") });
    const { res, hifrica } = await e.checkout("en-panne");
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.json(), { error: "engine_unavailable" });
    assert.equal(hifrica, null);
    // Un navigateur, lui, est renvoyé vers la fiche, sans lecture en base.
    const before = e.reads.length;
    const browser = await e.call({ method: "GET", url: "/en-panne/v1/checkout", headers: BROWSER });
    assert.equal(browser.res.statusCode, 302);
    assert.equal(browser.res.headers.location, `${APP}/catalogue/en-panne`);
    assert.equal(e.reads.length, before);
    await e.app.close();
  });

  it("cache : 2 appels = 1 lecture en base, puis relecture après expiration (30 s)", async () => {
    let now = 5_000_000;
    const e = engine({ "boutique-qr": row("boutique-qr") }, () => now);
    assert.equal((await e.checkout("boutique-qr")).res.statusCode, 201);
    assert.equal((await e.checkout("boutique-qr")).res.statusCode, 201);
    assert.deepEqual(e.reads, ["boutique-qr"]);
    now += 30_001;
    assert.equal((await e.checkout("boutique-qr")).res.statusCode, 201);
    assert.deepEqual(e.reads, ["boutique-qr", "boutique-qr"]);
    await e.app.close();
  });

  it("USSD publié : la route USSD le trouve avec une clé bien formée ; inconnu → 404 ; base en erreur → 503", async () => {
    const e = engine({
      "ussd-boutique": row("ussd-boutique", { kind: "ussd", yaml: rename(USSD_YAML, "ussd-boutique") }),
      "ussd-panne": new DbOperationError("get_executable_simulator", "connection"),
    });
    const ussd = (slug: string, headers: Record<string, string> = {}) =>
      e.call({ method: "POST", url: `/${slug}/ussd`, headers: { ...headers, "content-type": "application/json" }, payload: { text: "" } });
    // Trouvé : la route va au-delà de la résolution et de l'authentification (ni 404 ni 401).
    const found = await ussd("ussd-boutique", KEY);
    assert.ok(![401, 404].includes(found.res.statusCode), `statut ${found.res.statusCode}`);
    assert.ok(e.reads.includes("ussd-boutique"));
    assert.equal((await ussd("ussd-inconnu", KEY)).res.statusCode, 404);
    const down = await ussd("ussd-panne", KEY);
    assert.equal(down.res.statusCode, 503);
    assert.deepEqual(down.res.json(), { error: "engine_unavailable" });
    // Un simulateur USSD publié n'est pas exécuté par la route HTTP (même règle que pour les fichiers).
    assert.equal((await e.checkout("ussd-boutique")).res.statusCode, 404);
    await e.app.close();
  });

  it("navigateur sans clé sur un simulateur publié → 302 vers sa fiche, sans lecture en base", async () => {
    const e = engine({ "boutique-qr": row("boutique-qr") });
    for (const url of ["/boutique-qr/v1/checkout", "/boutique-qr"]) {
      const { res, hifrica } = await e.call({ method: "GET", url, headers: BROWSER });
      assert.equal(res.statusCode, 302, url);
      assert.equal(res.headers.location, `${APP}/catalogue/boutique-qr`, url);
      assert.equal(hifrica, null);
    }
    const unknown = await e.call({ method: "GET", url: "/pas-publie/x", headers: BROWSER });
    assert.equal(unknown.res.headers.location, `${APP}/catalogue/pas-publie`);
    assert.deepEqual(e.reads, [], "aucun appel à getExecutableSimulator");
    await e.app.close();
  });
});
