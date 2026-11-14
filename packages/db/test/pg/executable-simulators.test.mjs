// getExecutableSimulator : simulateurs publiés exécutables par le moteur (version courante uniquement).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { createDb, createPool, getExecutableSimulator, isDbOperationError, runMigrations } from "../../dist/index.js";
import { SKIP_REASON, createFreshDatabase } from "./helpers.mjs";

const yamlOf = (slug, version) => `name: ${slug}\nversion: ${version}\nkind: http\nendpoints: []\n`;

describe("getExecutableSimulator", { skip: SKIP_REASON }, () => {
  let fresh;
  let client;
  let pool;
  let db;

  before(async () => {
    fresh = await createFreshDatabase();
    await runMigrations({ databaseUrl: fresh.url });
    client = new pg.Client({ connectionString: fresh.url, options: "-c timezone=UTC" });
    await client.connect();
    pool = createPool(fresh.url, { max: 2 });
    db = createDb(pool);
  });
  after(async () => {
    await pool?.end();
    await client?.end();
    await fresh?.drop();
  });

  const newSlug = () => `exec-${randomBytes(4).toString("hex")}`;
  /** Simulateur et ses versions ; `current` : version courante (ou null pour aucune). */
  async function insertSimulator({ status = "draft", kind = "http", versions = ["1.0.0"], current = versions.at(-1) } = {}) {
    const slug = newSlug();
    const { rows } = await client.query("INSERT INTO simulators (slug, kind, status) VALUES ($1, $2, $3) RETURNING id", [slug, kind, status]);
    for (const v of versions) {
      await client.query("INSERT INTO simulator_versions (simulator_id, version, yaml, is_current) VALUES ($1, $2, $3, $4)", [
        rows[0].id,
        v,
        yamlOf(slug, v),
        v === current,
      ]);
    }
    return slug;
  }

  for (const status of ["verified", "draft", "to_verify"]) {
    test(`statut ${status} : trouvé, avec la version courante`, async () => {
      const slug = await insertSimulator({ status });
      assert.deepEqual(await getExecutableSimulator(db, slug), { slug, kind: "http", status, version: "1.0.0", yaml: yamlOf(slug, "1.0.0") });
    });
  }

  test("statut unpublished → null", async () => {
    assert.equal(await getExecutableSimulator(db, await insertSimulator({ status: "unpublished" })), null);
  });

  test("simulateur sans version courante → null", async () => {
    assert.equal(await getExecutableSimulator(db, await insertSimulator({ versions: ["1.0.0", "1.1.0"], current: null })), null);
    assert.equal(await getExecutableSimulator(db, await insertSimulator({ versions: [] })), null, "aucune version");
  });

  test("seule la version is_current est renvoyée (ni la plus récente, ni la première)", async () => {
    const slug = await insertSimulator({ versions: ["1.0.0", "1.1.0", "2.0.0"], current: "1.1.0" });
    const found = await getExecutableSimulator(db, slug);
    assert.equal(found.version, "1.1.0");
    assert.equal(found.yaml, yamlOf(slug, "1.1.0"));
  });

  test("simulateur USSD : kind renvoyé", async () => {
    const slug = await insertSimulator({ kind: "ussd", status: "verified" });
    assert.equal((await getExecutableSimulator(db, slug)).kind, "ussd");
  });

  test("slug inconnu → null", async () => {
    assert.equal(await getExecutableSimulator(db, newSlug()), null);
  });

  test("slug invalide → null sans requête SQL", async () => {
    let queries = 0;
    const counting = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "select") queries++;
        return Reflect.get(target, prop, receiver);
      },
    });
    for (const slug of ["", "ab", "Majuscule", "a b c", "x".repeat(61), "'; DROP TABLE simulators; --", "../etc"]) {
      assert.equal(await getExecutableSimulator(counting, slug), null, JSON.stringify(slug));
    }
    assert.equal(queries, 0);
  });

  test("base injoignable → DbOperationError get_executable_simulator, catégorie connection", async () => {
    const deadPool = createPool("postgres://nobody:x@127.0.0.1:1/none", { max: 1 });
    try {
      await assert.rejects(getExecutableSimulator(createDb(deadPool), newSlug()), (err) => {
        assert.ok(isDbOperationError(err));
        assert.equal(err.operation, "get_executable_simulator");
        assert.equal(err.kind, "connection");
        return true;
      });
    } finally {
      await deadPool.end();
    }
  });
});
