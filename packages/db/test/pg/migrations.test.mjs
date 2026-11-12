import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { MIGRATIONS_FOLDER, MIGRATION_LOCK_KEY, createPool, runMigrations } from "../../dist/index.js";
import { EXPECTED_TABLES, SKIP_REASON, appliedMigrations, createFreshDatabase, publicTables, withClient } from "./helpers.mjs";

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"));
const MIGRATION_COUNT = journal.entries.length;

describe("migrations sur une base PostgreSQL vierge", { skip: SKIP_REASON }, () => {
  test("base vierge : toutes les tables sont créées et chaque migration enregistrée une fois", async () => {
    const db = await createFreshDatabase();
    try {
      await withClient(db.url, async (c) => assert.deepEqual(await publicTables(c), []));
      await runMigrations({ databaseUrl: db.url });
      await withClient(db.url, async (c) => {
        assert.deepEqual(await publicTables(c), EXPECTED_TABLES);
        assert.equal((await appliedMigrations(c)).length, MIGRATION_COUNT);
      });
    } finally {
      await db.drop();
    }
  });

  test("redémarrage : une seconde exécution n'applique rien et ne casse rien", async () => {
    const db = await createFreshDatabase();
    try {
      await runMigrations({ databaseUrl: db.url });
      const before = await withClient(db.url, appliedMigrations);
      await runMigrations({ databaseUrl: db.url });
      const afterRun = await withClient(db.url, appliedMigrations);
      assert.deepEqual(afterRun, before);
    } finally {
      await db.drop();
    }
  });

  test("trois démarrages simultanés : le verrou sérialise, aucune erreur, aucun doublon", async () => {
    const db = await createFreshDatabase();
    try {
      await Promise.all([1, 2, 3].map(() => runMigrations({ databaseUrl: db.url, lockPollMs: 50 })));
      await withClient(db.url, async (c) => {
        assert.deepEqual(await publicTables(c), EXPECTED_TABLES);
        assert.equal((await appliedMigrations(c)).length, MIGRATION_COUNT);
      });
    } finally {
      await db.drop();
    }
  });

  test("verrou tenu par un autre processus : on attend, sans rien migrer, puis on abandonne proprement", async () => {
    const db = await createFreshDatabase();
    const holder = new pg.Client({ connectionString: db.url });
    await holder.connect();
    try {
      await holder.query("SELECT pg_advisory_lock($1::bigint)", [MIGRATION_LOCK_KEY]);
      await assert.rejects(runMigrations({ databaseUrl: db.url, lockTimeoutMs: 1500, lockPollMs: 100 }), /Verrou de migration non obtenu/);
      await withClient(db.url, async (c) => assert.deepEqual(await publicTables(c), []));
      await holder.query("SELECT pg_advisory_unlock($1::bigint)", [MIGRATION_LOCK_KEY]);
      await runMigrations({ databaseUrl: db.url });
      await withClient(db.url, async (c) => assert.deepEqual(await publicTables(c), EXPECTED_TABLES));
    } finally {
      await holder.end();
      await db.drop();
    }
  });

  test("après migration, aucun verrou consultatif ne reste tenu sur la base", async () => {
    const db = await createFreshDatabase();
    try {
      await runMigrations({ databaseUrl: db.url });
      await withClient(db.url, async (c) => {
        const { rows } = await c.query(
          "SELECT count(*)::int AS n FROM pg_locks l JOIN pg_database d ON d.oid = l.database WHERE l.locktype = 'advisory' AND d.datname = current_database()",
        );
        assert.equal(rows[0].n, 0);
      });
    } finally {
      await db.drop();
    }
  });

  test("base injoignable : nouvelles tentatives puis échec explicite", async () => {
    const messages = [];
    await assert.rejects(
      runMigrations({ databaseUrl: "postgres://nobody:x@127.0.0.1:1/none", connectAttempts: 2, connectRetryDelayMs: 50, log: (m) => messages.push(m) }),
    );
    assert.equal(messages.filter((m) => m.includes("tentative")).length, 1);
  });

  test("le pool de l'application travaille en UTC", async () => {
    const db = await createFreshDatabase();
    const pool = createPool(db.url, { max: 1 });
    try {
      const { rows } = await pool.query("SHOW timezone");
      assert.equal(rows[0].TimeZone, "UTC");
    } finally {
      await pool.end();
      await db.drop();
    }
  });
});
