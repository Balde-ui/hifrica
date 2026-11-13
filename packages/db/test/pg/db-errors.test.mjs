// E1 — erreurs RÉELLEMENT produites par PostgreSQL via Drizzle, puis converties en erreurs sûres.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { DrizzleQueryError } from "drizzle-orm";
import {
  DbOperationError,
  apiKeys,
  createDb,
  createPool,
  encryptWebhookSecret,
  generateApiKey,
  generateWebhookSecret,
  parseWebhookSecretKeyring,
  projects,
  requestLogs,
  runMigrations,
  safeDbCall,
  users,
} from "../../dist/index.js";
import { SKIP_REASON, createFreshDatabase } from "./helpers.mjs";

const PIN = "4821";

function assertNoSecret(err, secrets) {
  const texts = [err.message, err.stack ?? "", JSON.stringify(err), inspect(err, { depth: 10, showHidden: true }), String(err)];
  for (const text of texts) for (const s of secrets) assert.ok(!text.includes(s), "secret présent dans l'erreur convertie");
  assert.equal(Object.hasOwn(err, "cause"), false);
}

/** Capture l'erreur brute pour vérifier qu'elle contenait bien le secret (témoin), puis la convertit. */
async function rawAndSafe(operation, fn) {
  let raw;
  try {
    await fn();
  } catch (e) {
    raw = e;
  }
  assert.ok(raw, "une erreur était attendue");
  let safe;
  try {
    await safeDbCall(operation, fn);
  } catch (e) {
    safe = e;
  }
  return { raw, safe };
}

describe("erreurs PostgreSQL réelles converties", { skip: SKIP_REASON }, () => {
  let fresh;
  let pool;
  let db;
  let projectId;
  const keyring = parseWebhookSecretKeyring(`v1:${randomBytes(32).toString("base64")}`);

  before(async () => {
    fresh = await createFreshDatabase();
    await runMigrations({ databaseUrl: fresh.url });
    pool = createPool(fresh.url, { max: 2 });
    db = createDb(pool);
    const [user] = await db.insert(users).values({ name: "E1", email: `e1-${randomUUID()}@example.test` }).returning({ id: users.id });
    projectId = randomUUID();
    await db.insert(projects).values({
      id: projectId,
      ownerId: user.id,
      name: "E1",
      webhookSecretEnc: encryptWebhookSecret(generateWebhookSecret(), projectId, keyring),
    });
  });
  after(async () => {
    await pool?.end();
    await fresh?.drop();
  });

  const logRow = (over) => ({
    requestId: randomUUID(),
    projectId,
    simulatorSlug: "paiement-mobile-generique",
    channel: "http",
    outcome: "responded",
    method: "POST",
    path: "/v1/checkout",
    status: 201,
    durationMs: 5,
    request: { body: { action: "confirm", pin: PIN } },
    response: {},
    ...over,
  });

  test("CHECK violée avec un PIN dans la ligne : témoin brut qui fuit, erreur convertie propre", async () => {
    const { raw, safe } = await rawAndSafe("insert_request_log", () => db.insert(requestLogs).values(logRow({ outcome: "inconnu", status: null, response: null })));
    assert.ok(raw instanceof DrizzleQueryError, "erreur Drizzle réelle");
    assert.ok(raw.message.includes(PIN), "témoin : le message Drizzle contient le paramètre PIN");
    assert.equal(raw.cause.code, "23514");
    assert.ok(raw.cause.detail.includes(PIN), "témoin : detail de PostgreSQL contient le PIN");
    assert.ok(safe instanceof DbOperationError);
    assert.equal(safe.kind, "check_violation");
    assert.equal(safe.sqlstate, "23514");
    assert.equal(safe.constraint, "request_logs_outcome_chk");
    assertNoSecret(safe, [PIN]);
  });

  test("doublon d'empreinte de clé : ni la clé ni l'empreinte dans l'erreur convertie", async () => {
    const k = generateApiKey();
    await db.insert(apiKeys).values({ projectId, keyHash: k.hash, prefix: k.prefix, last4: k.last4 });
    const { raw, safe } = await rawAndSafe("create_api_key", () =>
      db.insert(apiKeys).values({ projectId, keyHash: k.hash, prefix: k.prefix, last4: k.last4, name: k.key.slice(0, 60) }),
    );
    assert.equal(raw.cause.code, "23505");
    assert.ok(raw.cause.detail.includes(k.hash.toString("hex")), "témoin : detail contient l'empreinte");
    assert.equal(safe.kind, "unique_violation");
    assert.equal(safe.constraint, "api_keys_key_hash_uidx");
    assertNoSecret(safe, [k.key, k.hash.toString("hex"), k.key.slice(0, 60)]);
  });

  test("uuid invalide contenant une clé d'API : le message PostgreSQL (qui recopie la valeur) n'est pas repris", async () => {
    const { key } = generateApiKey();
    const { raw, safe } = await rawAndSafe("insert_request_log", () => db.insert(requestLogs).values(logRow({ projectId: key })));
    assert.equal(raw.cause.code, "22P02");
    assert.ok(raw.cause.message.includes(key), "témoin : le message pg recopie la valeur");
    assert.equal(safe.kind, "invalid_input");
    assert.equal(safe.sqlstate, "22P02");
    assertNoSecret(safe, [key, PIN]);
  });

  test("clé étrangère violée : nom de contrainte conservé, valeurs absentes", async () => {
    const ghost = randomUUID();
    const { raw, safe } = await rawAndSafe("insert_request_log", () => db.insert(requestLogs).values(logRow({ projectId: ghost })));
    assert.equal(raw.cause.code, "23503");
    assert.equal(safe.kind, "foreign_key_violation");
    assert.equal(safe.constraint, "request_logs_project_id_projects_id_fk");
    assertNoSecret(safe, [ghost, PIN]);
  });

  test("P2 — 42P01 / 42703 réels : schema_mismatch, ni nom de table ni de colonne recopié", async () => {
    const table = `table_confidentielle_${randomBytes(4).toString("hex")}`;
    const column = `colonne_confidentielle_${randomBytes(4).toString("hex")}`;
    for (const [sqlText, code] of [[`SELECT * FROM ${table}`, "42P01"], [`SELECT ${column} FROM users`, "42703"]]) {
      const { raw, safe } = await rawAndSafe("resolve_api_key", () => pool.query(sqlText));
      assert.equal(raw.code, code);
      assert.ok(raw.message.includes(code === "42P01" ? table : column), "témoin : le message pg nomme l'objet");
      assert.equal(safe.kind, "schema_mismatch");
      assert.equal(safe.sqlstate, code);
      assertNoSecret(safe, [table, column]);
    }
  });

  test("P2 — 25P02 réel : transaction_aborted, sans la valeur de la requête fautive", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT $1::uuid", [PIN]).catch(() => undefined);
      const { raw, safe } = await rawAndSafe("insert_request_log", () => client.query("SELECT $1::text", [PIN]));
      assert.equal(raw.code, "25P02");
      assert.equal(safe.kind, "transaction_aborted");
      assert.equal(safe.sqlstate, "25P02");
      assertNoSecret(safe, [PIN]);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  test("P2 — 28P01 réel : authentication_failed, ni utilisateur ni mot de passe recopiés", async () => {
    const user = `utilisateur_confidentiel_${randomBytes(4).toString("hex")}`;
    const password = `mdp-${randomBytes(8).toString("hex")}`;
    const db = (await pool.query("SELECT current_database() AS d")).rows[0].d;
    const role = `role_${randomBytes(4).toString("hex")}`;
    // Rôle réel avec mot de passe, puis connexion avec un MAUVAIS mot de passe : vrai 28P01.
    await pool.query(`CREATE ROLE ${role} LOGIN PASSWORD '${randomBytes(12).toString("hex")}'`);
    try {
      for (const [who, label] of [[role, "rôle existant"], [user, "rôle inexistant"]]) {
        const url = new URL(fresh.url);
        url.username = who;
        url.password = password;
        const badPool = createPool(url.toString(), { max: 1 });
        try {
          const { raw, safe } = await rawAndSafe("resolve_api_key", () => badPool.query("SELECT 1"));
          assert.equal(raw.code, "28P01", `${label} : ${raw.code}`);
          assert.ok(raw.message.includes(who), "témoin : le message pg nomme l'utilisateur");
          assert.equal(safe.kind, "authentication_failed");
          assert.equal(safe.sqlstate, "28P01");
          assertNoSecret(safe, [who, password, db]);
        } finally {
          await badPool.end();
        }
      }
    } finally {
      await pool.query(`DROP ROLE ${role}`);
    }
  });

  test("P2 — 3D000 réel : database_not_found, sans le nom de la base", async () => {
    const missing = `base_confidentielle_${randomBytes(4).toString("hex")}`;
    const url = new URL(fresh.url);
    url.pathname = `/${missing}`;
    const badPool = createPool(url.toString(), { max: 1 });
    try {
      const { raw, safe } = await rawAndSafe("resolve_api_key", () => badPool.query("SELECT 1"));
      assert.equal(raw.code, "3D000");
      assert.ok(raw.message.includes(missing), "témoin : le message pg nomme la base");
      assert.equal(safe.kind, "database_not_found");
      assertNoSecret(safe, [missing, url.password]);
    } finally {
      await badPool.end();
    }
  });

  test("base injoignable : connection, sans URL ni identifiants", async () => {
    const secretPassword = `mdp-${randomBytes(6).toString("hex")}`;
    const badPool = createPool(`postgres://hifrica:${secretPassword}@127.0.0.1:1/none`, { max: 1 });
    try {
      const { safe } = await rawAndSafe("resolve_api_key", () => createDb(badPool).select().from(users).limit(1));
      assert.equal(safe.kind, "connection");
      assertNoSecret(safe, [secretPassword]);
    } finally {
      await badPool.end();
    }
  });
});
