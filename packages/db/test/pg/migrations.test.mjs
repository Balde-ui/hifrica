import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import {
  MIGRATIONS_FOLDER,
  MIGRATION_LOCK_KEY,
  createPool,
  encryptWebhookSecret,
  generateWebhookSecret,
  parseWebhookSecretKeyring,
  runMigrations,
} from "../../dist/index.js";
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
  test("base déjà migrée jusqu'à 0001 (avec données) : seule 0002 est appliquée, données conservées", async () => {
    const db = await createFreshDatabase();
    const partial = mkdtempSync(join(tmpdir(), "hifrica-migrations-0001-"));
    try {
      // Copie du dossier de migrations, journal tronqué aux deux premières entrées (0000, 0001).
      cpSync(MIGRATIONS_FOLDER, partial, { recursive: true });
      const partialJournal = { ...journal, entries: journal.entries.slice(0, 2) };
      assert.deepEqual(partialJournal.entries.map((e) => e.tag), ["0000_init", "0001_users_role_check"]);
      writeFileSync(join(partial, "meta", "_journal.json"), JSON.stringify(partialJournal));
      await runMigrations({ databaseUrl: db.url, migrationsFolder: partial });

      const keyring = parseWebhookSecretKeyring(`v1:${randomBytes(32).toString("base64")}`);
      const projectId = randomUUID();
      const requestId = randomUUID();
      await withClient(db.url, async (c) => {
        assert.equal((await appliedMigrations(c)).length, 2);
        const { rows: cols } = await c.query(
          "SELECT 1 FROM information_schema.columns WHERE table_name = 'request_logs' AND column_name = 'session_id'",
        );
        assert.equal(cols.length, 0, "session_id absente avant 0002");
        const { rows: u } = await c.query(
          "INSERT INTO users (name, email, updated_at) VALUES ('M', $1, now()) RETURNING id",
          [`mig-${randomUUID()}@example.test`],
        );
        await c.query("INSERT INTO projects (id, owner_id, name, webhook_secret_enc) VALUES ($1, $2, 'P', $3)", [
          projectId,
          u[0].id,
          encryptWebhookSecret(generateWebhookSecret(), projectId, keyring),
        ]);
        await c.query(
          `INSERT INTO request_logs (request_id, project_id, simulator_slug, outcome, method, path, status, duration_ms, request, response)
           VALUES ($1, $2, 'paiement-mobile-generique', 'responded', 'POST', '/v1/checkout', 201, 3, '{}', '{}')`,
          [requestId, projectId],
        );
      });

      await runMigrations({ databaseUrl: db.url });

      await withClient(db.url, async (c) => {
        assert.equal((await appliedMigrations(c)).length, MIGRATION_COUNT, "0002 appliquée une seule fois");
        const { rows: col } = await c.query(
          "SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'request_logs' AND column_name = 'session_id'",
        );
        assert.deepEqual(col[0], { data_type: "text", is_nullable: "YES" });
        const { rows: kept } = await c.query("SELECT session_id, simulator_slug FROM request_logs WHERE request_id = $1", [requestId]);
        assert.equal(kept.length, 1, "la ligne existante est conservée");
        assert.equal(kept[0].session_id, null);
        const { rows: idx } = await c.query(
          "SELECT 1 FROM pg_indexes WHERE tablename = 'request_logs' AND indexname = 'request_logs_project_session_idx'",
        );
        assert.equal(idx.length, 1);
      });

      await runMigrations({ databaseUrl: db.url });
      await withClient(db.url, async (c) => assert.equal((await appliedMigrations(c)).length, MIGRATION_COUNT, "redémarrage sans effet"));
    } finally {
      rmSync(partial, { recursive: true, force: true });
      await db.drop();
    }
  });

  test("base déjà migrée jusqu'à 0002 (avec données) : seule 0003 (webhook_deliveries) est appliquée, données conservées", async () => {
    const db = await createFreshDatabase();
    const partial = mkdtempSync(join(tmpdir(), "hifrica-migrations-0002-"));
    try {
      cpSync(MIGRATIONS_FOLDER, partial, { recursive: true });
      const partialJournal = { ...journal, entries: journal.entries.slice(0, 3) };
      assert.deepEqual(partialJournal.entries.map((e) => e.tag), ["0000_init", "0001_users_role_check", "0002_request_logs_session_id"]);
      writeFileSync(join(partial, "meta", "_journal.json"), JSON.stringify(partialJournal));
      await runMigrations({ databaseUrl: db.url, migrationsFolder: partial });

      const keyring = parseWebhookSecretKeyring(`v1:${randomBytes(32).toString("base64")}`);
      const projectId = randomUUID();
      await withClient(db.url, async (c) => {
        assert.equal((await appliedMigrations(c)).length, 3);
        assert.ok(!(await publicTables(c)).includes("webhook_deliveries"), "table absente avant 0003");
        const { rows: u } = await c.query(
          "INSERT INTO users (name, email, updated_at) VALUES ('M', $1, now()) RETURNING id",
          [`mig3-${randomUUID()}@example.test`],
        );
        await c.query(
          "INSERT INTO projects (id, owner_id, name, webhook_url, webhook_secret_enc) VALUES ($1, $2, 'P', 'https://hooks.exemple.test/w', $3)",
          [projectId, u[0].id, encryptWebhookSecret(generateWebhookSecret(), projectId, keyring)],
        );
      });

      await runMigrations({ databaseUrl: db.url });

      await withClient(db.url, async (c) => {
        assert.equal((await appliedMigrations(c)).length, MIGRATION_COUNT, "0003 appliquée une seule fois");
        assert.deepEqual(await publicTables(c), EXPECTED_TABLES);
        const { rows: kept } = await c.query("SELECT webhook_url FROM projects WHERE id = $1", [projectId]);
        assert.equal(kept[0].webhook_url, "https://hooks.exemple.test/w", "le projet existant est conservé");
        await c.query(
          `INSERT INTO webhook_deliveries (delivery_id, project_id, event, attempt, outcome, status_code, duration_ms, destination_host)
           VALUES ($1, $2, 'checkout.completed', 1, 'success', 200, 5, 'hooks.exemple.test')`,
          [randomUUID(), projectId],
        );
      });
      await runMigrations({ databaseUrl: db.url });
      await withClient(db.url, async (c) => assert.equal((await appliedMigrations(c)).length, MIGRATION_COUNT, "redémarrage sans effet"));
    } finally {
      rmSync(partial, { recursive: true, force: true });
      await db.drop();
    }
  });
});
