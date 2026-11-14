// Résolution des simulateurs : fichiers prioritaires, simulateurs publiés (base simulée), cache, erreurs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DbOperationError, type Database, type ExecutableSimulator } from "@hifrica/db";
import { projectChannel, validateSimulatorYaml, type PhoneSession } from "@hifrica/shared";
import { createCatalog, DB_TIMEOUT_MS, EngineUnavailableError, FOUND_TTL_MS, MAX_CACHE_ENTRIES, MISSING_TTL_MS, toResolver } from "./catalog.js";
import { handleConfirmationMessage } from "./confirmations.js";
import type { SessionStore } from "./phone-session.js";
import type { Simulator } from "./simulators.js";
import type { ScheduleWebhookOptions } from "./webhooks.js";

const read = (file: string) => readFileSync(new URL(`../../../simulators/${file}`, import.meta.url), "utf8");
const FILE_YAML = read("paiement-mobile-generique.yaml");
const fileSim = validateSimulatorYaml(FILE_YAML).simulator as Simulator;

/** YAML d'un simulateur publié : le simulateur du dépôt, renommé (et éventuellement modifié). */
const publishedYaml = (slug: string, status = "pending") =>
  FILE_YAML.replace(/^name: .+$/m, `name: ${slug}`).replace('status: "pending"', `status: "${status}"`);

const FAKE_DB = {} as Database;

interface Row extends Omit<ExecutableSimulator, "status"> {
  status: ExecutableSimulator["status"];
}

/** Base simulée : renvoie la ligne du slug (ou null), compte les lectures, peut lever. */
function fakeDb(rows: Record<string, Row | Error> = {}) {
  const reads: string[] = [];
  const fetchPublished = async (_db: Database, slug: string): Promise<ExecutableSimulator | null> => {
    reads.push(slug);
    const row = rows[slug];
    if (row instanceof Error) throw row;
    return row ?? null;
  };
  return { reads, fetchPublished, rows };
}

const row = (slug: string, over: Partial<Row> = {}): Row => ({ slug, kind: "http", status: "draft", version: "1.0.0", yaml: publishedYaml(slug), ...over });

function logger() {
  const errors: { obj: Record<string, unknown>; msg: string }[] = [];
  return {
    errors,
    log: { error: (obj: Record<string, unknown>, msg: string) => void errors.push({ obj, msg }), warn: () => undefined } as never,
  };
}

function catalog(rows: Record<string, Row | Error> = {}, extra: { now?: () => number; maxEntries?: number; withDb?: boolean } = {}) {
  const db = fakeDb(rows);
  const l = logger();
  const c = createCatalog({
    files: new Map([[fileSim.name, fileSim]]),
    log: l.log,
    getDb: () => (extra.withDb === false ? null : FAKE_DB),
    fetchPublished: db.fetchPublished,
    now: extra.now,
    maxEntries: extra.maxEntries,
  });
  return { c, ...db, ...l };
}

describe("catalogue des simulateurs (fichiers puis publiés)", () => {
  it("le fichier est prioritaire sur un simulateur publié du même slug, sans lecture en base", async () => {
    const { c, reads } = catalog({ [fileSim.name]: row(fileSim.name, { yaml: publishedYaml(fileSim.name, "PUBLIE") }) });
    assert.equal(await c.resolve(fileSim.name), fileSim);
    assert.deepEqual(reads, []);
  });

  for (const status of ["draft", "to_verify", "verified"] as const) {
    it(`publié ${status} : construit comme un fichier (même schéma)`, async () => {
      const { c } = catalog({ "boutique-qr": row("boutique-qr", { status }) });
      const sim = await c.resolve("boutique-qr");
      assert.equal(sim?.name, "boutique-qr");
      assert.equal(sim?.kind, "http");
      assert.deepEqual(sim?.endpoints?.map((e) => e.id), fileSim.endpoints?.map((e) => e.id));
    });
  }

  it("absent ou dépublié (getExecutableSimulator → null) → null", async () => {
    const { c, reads } = catalog();
    assert.equal(await c.resolve("jamais-publie"), null);
    assert.deepEqual(reads, ["jamais-publie"]);
  });

  it("YAML invalide en base → null, log d'erreur (slug, version) sans le YAML, jamais exécuté", async () => {
    const { c, errors } = catalog({ "yaml-casse": row("yaml-casse", { version: "1.2.0", yaml: "name: yaml-casse\nkind: http\nendpoints: 12\nsecret: sk_test_x\n" }) });
    assert.equal(await c.resolve("yaml-casse"), null);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].obj.slug, "yaml-casse");
    assert.equal(errors[0].obj.version, "1.2.0");
    assert.ok(!JSON.stringify(errors).includes("sk_test_x"), "le YAML n'est pas journalisé");
  });

  it("YAML valide mais dont le name diffère du slug → null (jamais exécuté sous un autre nom)", async () => {
    const { c, errors } = catalog({ "slug-a": row("slug-a", { yaml: publishedYaml("slug-b") }) });
    assert.equal(await c.resolve("slug-a"), null);
    assert.equal(errors.length, 1);
  });

  it("base en erreur → EngineUnavailableError (pas null), non mise en cache", async () => {
    const { c, reads } = catalog({ "en-panne": new DbOperationError("get_executable_simulator", "connection") });
    for (let i = 0; i < 2; i++) {
      await assert.rejects(c.resolve("en-panne"), (err) => err instanceof EngineUnavailableError && err.reason === "connection");
    }
    assert.equal(reads.length, 2, "une erreur n'est pas gardée en cache");
  });

  it("base muette (requête sans réponse) → EngineUnavailableError timeout, non mise en cache", async () => {
    const l = logger();
    let reads = 0;
    const c = createCatalog({
      files: new Map(),
      log: l.log,
      getDb: () => FAKE_DB,
      fetchPublished: () => (reads++, new Promise<never>(() => undefined)),
      dbTimeoutMs: 20,
    });
    await assert.rejects(c.resolve("base-figee"), (err) => err instanceof EngineUnavailableError && err.reason === "timeout");
    await assert.rejects(c.resolve("base-figee"));
    assert.equal(reads, 2);
    assert.equal(l.errors[0].obj.reason, "timeout");
    assert.equal(DB_TIMEOUT_MS, 3000);
  });

  it("sans base (développement local) : les fichiers seulement", async () => {
    const { c, reads } = catalog({ "boutique-qr": row("boutique-qr") }, { withDb: false });
    assert.equal(await c.resolve(fileSim.name), fileSim);
    assert.equal(await c.resolve("boutique-qr"), null);
    assert.deepEqual(reads, []);
  });

  it("slug invalide → null, sans lecture en base ni entrée de cache", async () => {
    const { c, reads } = catalog();
    for (const slug of ["", "AB", "a/b", "x".repeat(61)]) assert.equal(await c.resolve(slug), null);
    assert.deepEqual(reads, []);
    assert.equal(c.size, 0);
  });

  it("cache : 2 appels = 1 lecture ; relecture après 30 s (trouvé) — la version courante est alors relue", async () => {
    let now = 1_000_000;
    const { c, reads, rows } = catalog({ "boutique-qr": row("boutique-qr") }, { now: () => now });
    assert.equal((await c.resolve("boutique-qr"))?.name, "boutique-qr");
    assert.equal((await c.resolve("boutique-qr"))?.name, "boutique-qr");
    assert.equal(reads.length, 1);

    // Nouvelle version publiée : visible au plus 30 s après.
    rows["boutique-qr"] = row("boutique-qr", { version: "1.1.0", yaml: publishedYaml("boutique-qr", "v2") });
    now += FOUND_TTL_MS - 1;
    assert.match(JSON.stringify(await c.resolve("boutique-qr")), /"pending"/, "encore en cache");
    now += 2;
    assert.match(JSON.stringify(await c.resolve("boutique-qr")), /"v2"/, "relu après expiration");
    assert.equal(reads.length, 2);
  });

  it("cache des absents : 10 s, puis relecture (un simulateur tout juste publié apparaît)", async () => {
    let now = 1_000_000;
    const { c, reads, rows } = catalog({}, { now: () => now });
    assert.equal(await c.resolve("bientot-publie"), null);
    rows["bientot-publie"] = row("bientot-publie");
    now += MISSING_TTL_MS - 1;
    assert.equal(await c.resolve("bientot-publie"), null);
    now += 2;
    assert.equal((await c.resolve("bientot-publie"))?.name, "bientot-publie");
    assert.equal(reads.length, 2);
  });

  it("dépublié : ne répond plus au plus 30 s après", async () => {
    let now = 1_000_000;
    const { c, rows } = catalog({ "a-retirer": row("a-retirer") }, { now: () => now });
    assert.ok(await c.resolve("a-retirer"));
    delete rows["a-retirer"];
    now += FOUND_TTL_MS + 1;
    assert.equal(await c.resolve("a-retirer"), null);
  });

  it("appels simultanés au même slug : une seule lecture en base", async () => {
    const { c, reads } = catalog({ "boutique-qr": row("boutique-qr") });
    const results = await Promise.all(Array.from({ length: 5 }, () => c.resolve("boutique-qr")));
    assert.ok(results.every((s) => s?.name === "boutique-qr"));
    assert.equal(reads.length, 1);
  });

  it(`au plus ${MAX_CACHE_ENTRIES} entrées : les plus anciennes sortent`, async () => {
    const { c, reads } = catalog({}, { maxEntries: 3 });
    for (const slug of ["sim-aaa", "sim-bbb", "sim-ccc", "sim-ddd"]) await c.resolve(slug);
    assert.equal(c.size, 3);
    await c.resolve("sim-ddd"); // encore en cache
    assert.equal(reads.length, 4);
    await c.resolve("sim-aaa"); // la plus ancienne était sortie : relue
    assert.equal(reads.length, 5);
    assert.equal(MAX_CACHE_ENTRIES, 500);
  });

  it("toResolver : une Map se comporte comme avant", async () => {
    const resolve = toResolver(new Map([[fileSim.name, fileSim]]));
    assert.equal(await resolve(fileSim.name), fileSim);
    assert.equal(await resolve("inconnu"), null);
  });
});

describe("A4 : phone.confirm sur un simulateur publié", () => {
  const SLUG = "boutique-qr";
  const ID = "7c0a9e7e-3f4b-4a8e-9d2b-0123456789ab";
  const session = (): PhoneSession => ({
    sessionId: ID,
    projectId: "demo",
    simulator: SLUG,
    endpointId: "checkout",
    requestId: "req-origine",
    status: "confirmed",
    createdAt: new Date().toISOString(),
    ctx: { body: { amount: 5000, merchant: "Boutique" }, query: {}, params: {} },
    response: { status: 201, body: { id: ID, status: "pending", amount: 5000, currency: "XOF" } },
  });
  const store = (fired: Set<string>): SessionStore => ({
    create: async () => true,
    get: async () => session(),
    markFired: async (id) => (fired.has(id) ? false : (fired.add(id), true)),
  });
  const message = JSON.stringify({ type: "phone.confirm", sessionId: ID, projectId: "demo", createdAt: new Date().toISOString(), requestId: "req-2" });
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

  it("le webhook « on: phone.confirm » du simulateur publié est programmé", async () => {
    const { c } = catalog({ [SLUG]: row(SLUG) });
    const scheduled: ScheduleWebhookOptions[] = [];
    const outcome = await handleConfirmationMessage(projectChannel("demo"), message, {
      simulators: c.resolve,
      store: store(new Set()),
      schedule: async (opts) => void scheduled.push(opts),
      log: quiet,
    });
    assert.equal(outcome, "scheduled");
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].simulator, SLUG);
    assert.equal(scheduled[0].projectId, "demo");
    assert.equal(scheduled[0].event, "checkout.completed");
    assert.equal((scheduled[0].body as { id: string }).id, ID);
  });

  it("base injoignable : engine_unavailable, la session n'est pas marquée (une republication réussira)", async () => {
    const rows: Record<string, Row | Error> = { [SLUG]: new DbOperationError("get_executable_simulator", "connection") };
    const { c } = catalog(rows);
    const fired = new Set<string>();
    const scheduled: ScheduleWebhookOptions[] = [];
    const deps = { simulators: c.resolve, store: store(fired), schedule: async (o: ScheduleWebhookOptions) => void scheduled.push(o), log: quiet };
    assert.equal(await handleConfirmationMessage(projectChannel("demo"), message, deps), "engine_unavailable");
    assert.equal(fired.size, 0);
    rows[SLUG] = row(SLUG);
    assert.equal(await handleConfirmationMessage(projectChannel("demo"), message, deps), "scheduled");
    assert.equal(scheduled.length, 1);
  });
});
