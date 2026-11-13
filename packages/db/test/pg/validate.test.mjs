// E1 / M1 — les validateurs de validate.ts confrontés aux VRAIES contraintes de la base migrée.
// Règle prouvée : tout ce que le validateur accepte, la base l'accepte ; et pour error_code et slug
// (motifs identiques aux CHECK), tout ce que le validateur refuse, la base le refuse aussi.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isErrorCode, isHttpMethod, isSlug, isUuid, runMigrations } from "../../dist/index.js";
import { SKIP_REASON, createFreshDatabase, withClient } from "./helpers.mjs";

const ERROR_CODES = ["a", "timeout", "payment.insufficient_funds", "e2", "a" + "b".repeat(63), "a" + "b".repeat(64),
  "", "Timeout", "2fa", ".x", "_x", "a-b", "a b", " a", "a\n", "ça", "pin=4821"];
const SLUGS = ["abc", "paiement-mobile-generique", "123", "---", "a".repeat(60), "a".repeat(61),
  "", "ab", "Abc", "abc ", " abc", "a_b", "abc\n", "été", "a/b"];
const METHODS = ["GET", "POST", "PATCH", "DELETE", "OPTIONS", "M-SEARCH", "get", "A", "PROPPATCHX",
  "", " GET", "G ET", "GET\n", "PÖST", "ABCDEFGHIJK"];
const UUIDS = ["123e4567-e89b-12d3-a456-426614174000", "123E4567-E89B-12D3-A456-426614174000",
  "{123e4567-e89b-12d3-a456-426614174000}", "123e4567e89b12d3a456426614174000", " 123e4567-e89b-12d3-a456-426614174000", "nope"];

describe("validate.ts aligné sur les CHECK de la base", { skip: SKIP_REASON }, () => {
  let fresh;
  before(async () => {
    fresh = await createFreshDatabase();
    await runMigrations({ databaseUrl: fresh.url });
  });
  after(async () => {
    await fresh?.drop();
  });

  /** Exécute `sql` dans un point de sauvegarde ; renvoie true si la base l'accepte, false si une contrainte la refuse. */
  async function accepted(client, sql, params, expectedCodes) {
    await client.query("SAVEPOINT v");
    try {
      await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT v");
      return true;
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT v");
      assert.ok(expectedCodes.includes(e.code), `rejet inattendu : SQLSTATE ${e.code}`);
      return false;
    }
  }

  async function withFixtures(fn) {
    await withClient(fresh.url, async (client) => {
      await client.query("BEGIN");
      try {
        const { rows: [user] } = await client.query(
          "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES ($1, 'v', $2, false, now(), now()) RETURNING id",
          [randomUUID(), `v-${randomUUID()}@example.test`],
        );
        const { rows: [project] } = await client.query("INSERT INTO projects (owner_id, name, webhook_secret_enc) VALUES ($1, 'v', 'v1:aaaa.bbbb') RETURNING id", [user.id]);
        await fn(client, project.id);
      } finally {
        await client.query("ROLLBACK");
      }
    });
  }

  const insertLog = (client, projectId, { errorCode = null, method = "POST" }, codes) =>
    accepted(
      client,
      `INSERT INTO request_logs (request_id, project_id, simulator_slug, channel, outcome, method, path, duration_ms, request, error_code)
       VALUES ($1, $2, 'paiement-mobile-generique', 'ussd', 'responded', $3, '/', 1, '{}'::jsonb, $4)`,
      [randomUUID(), projectId, method, errorCode],
      codes,
    );

  test("error_code : isErrorCode(v) ⇔ request_logs_error_code_chk accepte v", async () => {
    await withFixtures(async (client, projectId) => {
      for (const v of ERROR_CODES) {
        assert.equal(await insertLog(client, projectId, { errorCode: v }, ["23514"]), isErrorCode(v), `désaccord sur ${JSON.stringify(v)}`);
      }
    });
  });

  test("slug : isSlug(v) ⇔ simulators_slug_chk accepte v", async () => {
    await withFixtures(async (client) => {
      for (const v of SLUGS) {
        const ok = await accepted(client, "INSERT INTO simulators (slug, kind) VALUES ($1, 'http')", [v], ["23514"]);
        assert.equal(ok, isSlug(v), `désaccord sur ${JSON.stringify(v)}`);
      }
    });
  });

  test("méthode : tout ce qu'accepte isHttpMethod, la base l'accepte (le validateur est plus strict)", async () => {
    await withFixtures(async (client, projectId) => {
      for (const v of METHODS) {
        const ok = await insertLog(client, projectId, { method: v }, ["23514"]);
        if (isHttpMethod(v)) assert.equal(ok, true, `refusé par la base : ${JSON.stringify(v)}`);
        if (v === "" || [...v].length > 10) assert.equal(ok, false, "le CHECK de longueur doit refuser");
      }
    });
  });

  test("uuid : tout ce qu'accepte isUuid est un uuid PostgreSQL, relu en minuscules", async () => {
    await withClient(fresh.url, async (client) => {
      for (const v of UUIDS) {
        if (!isUuid(v)) continue;
        const { rows: [r] } = await client.query("SELECT $1::uuid::text AS u", [v]);
        assert.equal(r.u, v.toLowerCase());
      }
      // Témoin : PostgreSQL accepte des écritures que isUuid refuse volontairement.
      assert.equal(isUuid("{123e4567-e89b-12d3-a456-426614174000}"), false);
      const { rows: [r] } = await client.query("SELECT $1::uuid::text AS u", ["{123e4567-e89b-12d3-a456-426614174000}"]);
      assert.equal(r.u, "123e4567-e89b-12d3-a456-426614174000");
    });
  });
});
