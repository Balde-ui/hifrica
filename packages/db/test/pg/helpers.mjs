// Outils des tests PostgreSQL. Chaque série de tests travaille sur une base VIERGE créée pour l'occasion,
// sur un serveur de test désigné par HIFRICA_TEST_PG_ADMIN_URL (jamais la production).
// Exemple : HIFRICA_TEST_PG_ADMIN_URL=postgres://postgres:<mdp>@127.0.0.1:55432/postgres
import { randomBytes } from "node:crypto";
import pg from "pg";

export const ADMIN_URL = process.env.HIFRICA_TEST_PG_ADMIN_URL;
export const SKIP_REASON = ADMIN_URL ? false : "HIFRICA_TEST_PG_ADMIN_URL non définie : tests PostgreSQL ignorés";

export async function createFreshDatabase() {
  const name = `hifrica_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return {
    name,
    url: url.toString(),
    async drop() {
      const client = new pg.Client({ connectionString: ADMIN_URL });
      await client.connect();
      try {
        await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await client.end();
      }
    },
  };
}

export async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url, options: "-c timezone=UTC" });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function publicTables(client) {
  const { rows } = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  return rows.map((r) => r.table_name);
}

export async function appliedMigrations(client) {
  const { rows } = await client.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id");
  return rows;
}

/** Vérifie qu'une requête est rejetée par une contrainte précise (code SQLSTATE et nom). */
export async function assertViolation(assert, promise, { code, constraint }) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `code SQLSTATE attendu ${code}, obtenu ${error.code} (${error.message})`);
    if (constraint) assert.equal(error.constraint, constraint);
    return true;
  });
}

export const EXPECTED_TABLES = [
  "accounts",
  "api_keys",
  "project_simulators",
  "projects",
  "request_logs",
  "sessions",
  "simulator_versions",
  "simulators",
  "users",
  "verifications",
];
