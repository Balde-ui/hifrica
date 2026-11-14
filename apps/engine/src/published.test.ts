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

  it("publié : la vraie clé reste obligatoire (401 sans clé)", async () => {
    const e = engine({ "boutique-qr": row("boutique-qr") });
    const { res } = await e.checkout("boutique-qr", {});
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { error: "invalid_test_key" });
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
    // Un navigateur, lui, est renvoyé vers le catalogue.
    const browser = await e.call({ method: "GET", url: "/en-panne/v1/checkout", headers: BROWSER });
    assert.equal(browser.res.statusCode, 302);
    assert.equal(browser.res.headers.location, `${APP}/catalogue`);
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

  it("USSD publié : la route USSD le trouve (401 sans clé, et non 404) ; inconnu → 404 ; base en erreur → 503", async () => {
    const e = engine({
      "ussd-boutique": row("ussd-boutique", { kind: "ussd", yaml: rename(USSD_YAML, "ussd-boutique") }),
      "ussd-panne": new DbOperationError("get_executable_simulator", "connection"),
    });
    const ussd = (slug: string, headers: Record<string, string> = {}) =>
      e.call({ method: "POST", url: `/${slug}/ussd`, headers: { ...headers, "content-type": "application/json" }, payload: { text: "" } });
    assert.equal((await ussd("ussd-boutique")).res.statusCode, 401);
    assert.equal((await ussd("ussd-inconnu")).res.statusCode, 404);
    const down = await ussd("ussd-panne");
    assert.equal(down.res.statusCode, 503);
    assert.deepEqual(down.res.json(), { error: "engine_unavailable" });
    // Un simulateur USSD publié n'est pas exécuté par la route HTTP (même règle que pour les fichiers).
    assert.equal((await e.checkout("ussd-boutique")).res.statusCode, 404);
    await e.app.close();
  });

  it("navigateur sur un simulateur publié → 302 vers sa fiche, sans authentification", async () => {
    const e = engine({ "boutique-qr": row("boutique-qr") });
    for (const url of ["/boutique-qr/v1/checkout", "/boutique-qr"]) {
      const { res, hifrica } = await e.call({ method: "GET", url, headers: BROWSER });
      assert.equal(res.statusCode, 302, url);
      assert.equal(res.headers.location, `${APP}/catalogue/boutique-qr`, url);
      assert.equal(hifrica, null);
    }
    const unknown = await e.call({ method: "GET", url: "/pas-publie/x", headers: BROWSER });
    assert.equal(unknown.res.headers.location, `${APP}/catalogue`);
    await e.app.close();
  });
});
