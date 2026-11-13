// Contraintes, relations et règles de suppression, vérifiées directement en SQL sur une base migrée.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  generateApiKey,
  generateWebhookSecret,
  parseWebhookSecretKeyring,
  runMigrations,
} from "../../dist/index.js";
import { SKIP_REASON, assertViolation, createFreshDatabase } from "./helpers.mjs";

const CHECK = "23514";
const UNIQUE = "23505";
const NOT_NULL = "23502";

describe("contraintes et relations", { skip: SKIP_REASON }, () => {
  let db;
  let client;
  const keyring = parseWebhookSecretKeyring(`v1:${randomBytes(32).toString("base64")}`);

  before(async () => {
    db = await createFreshDatabase();
    await runMigrations({ databaseUrl: db.url });
    client = new pg.Client({ connectionString: db.url, options: "-c timezone=UTC" });
    await client.connect();
  });
  after(async () => {
    await client?.end();
    await db?.drop();
  });

  const q = (sql, params) => client.query(sql, params);
  async function insertUser() {
    const { rows } = await q(
      "INSERT INTO users (name, email, updated_at) VALUES ('Test', $1, now()) RETURNING id, role",
      [`c1-${randomUUID()}@example.test`],
    );
    return rows[0];
  }
  async function insertProject(ownerId) {
    const id = randomUUID();
    const enc = encryptWebhookSecret(generateWebhookSecret(), id, keyring);
    await q("INSERT INTO projects (id, owner_id, name, webhook_secret_enc) VALUES ($1, $2, 'Projet', $3)", [id, ownerId, enc]);
    return id;
  }
  async function insertSimulator(slug = `sim-${randomBytes(4).toString("hex")}`, ownerId = null) {
    const { rows } = await q("INSERT INTO simulators (slug, kind, owner_id) VALUES ($1, 'http', $2) RETURNING id", [slug, ownerId]);
    return rows[0].id;
  }
  const logRow = (projectId, over = {}) => ({
    request_id: randomUUID(), project_id: projectId, simulator_slug: "paiement-mobile-generique", channel: "http",
    outcome: "responded", method: "POST", path: "/v1/checkout", status: 201, duration_ms: 12,
    request: "{}", response: "{}", ...over,
  });
  async function insertLog(row) {
    const cols = Object.keys(row);
    return q(`INSERT INTO request_logs (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, Object.values(row));
  }

  test("users.role : 'user' par défaut, valeur hors liste refusée (migration custom)", async () => {
    const user = await insertUser();
    assert.equal(user.role, "user");
    await assertViolation(assert, q("UPDATE users SET role = 'superadmin' WHERE id = $1", [user.id]), { code: CHECK, constraint: "users_role_chk" });
    await q("UPDATE users SET role = 'admin' WHERE id = $1", [user.id]);
  });

  test("accounts : un compte OAuth (provider_id, account_id) ne peut être rattaché qu'une fois", async () => {
    const a = await insertUser();
    const b = await insertUser();
    await q("INSERT INTO accounts (account_id, provider_id, user_id, updated_at) VALUES ('12345', 'github', $1, now())", [a.id]);
    await assertViolation(
      assert,
      q("INSERT INTO accounts (account_id, provider_id, user_id, updated_at) VALUES ('12345', 'github', $1, now())", [b.id]),
      { code: UNIQUE, constraint: "accounts_provider_account_uidx" },
    );
  });

  test("projects : secret de webhook obligatoire et jamais en clair ; URL http(s) seulement", async () => {
    const user = await insertUser();
    const id = await insertProject(user.id);
    const { rows } = await q("SELECT webhook_secret_enc FROM projects WHERE id = $1", [id]);
    assert.match(rows[0].webhook_secret_enc, /^v1:/);
    assert.match(decryptWebhookSecret(rows[0].webhook_secret_enc, id, keyring), /^whsec_/);
    await assertViolation(assert, q("INSERT INTO projects (owner_id, name) VALUES ($1, 'x')", [user.id]), { code: NOT_NULL });
    await assertViolation(
      assert,
      q("INSERT INTO projects (owner_id, name, webhook_secret_enc) VALUES ($1, 'x', 'whsec_en_clair')", [user.id]),
      { code: CHECK, constraint: "projects_webhook_secret_enc_chk" },
    );
    await assertViolation(assert, q("UPDATE projects SET webhook_url = 'ftp://x' WHERE id = $1", [id]), { code: CHECK, constraint: "projects_webhook_url_chk" });
    await assertViolation(assert, q("UPDATE projects SET name = ' x' WHERE id = $1", [id]), { code: CHECK, constraint: "projects_name_chk" });
    await q("UPDATE projects SET webhook_url = 'https://app.exemple.test/webhooks' WHERE id = $1", [id]);
  });

  test("api_keys : empreinte de 32 octets exactement et unique", async () => {
    const user = await insertUser();
    const projectId = await insertProject(user.id);
    const k = generateApiKey();
    const insert = (hash, prefix = k.prefix) =>
      q("INSERT INTO api_keys (project_id, key_hash, prefix, last4) VALUES ($1, $2, $3, $4)", [projectId, hash, prefix, k.last4]);
    await insert(k.hash);
    await assertViolation(assert, insert(k.hash), { code: UNIQUE, constraint: "api_keys_key_hash_uidx" });
    await assertViolation(assert, insert(k.hash.subarray(0, 31)), { code: CHECK, constraint: "api_keys_key_hash_len_chk" });
    await assertViolation(assert, insert(generateApiKey().hash, "sk_live_abcd"), { code: CHECK, constraint: "api_keys_prefix_chk" });
  });

  test("simulateurs : slug conforme au schéma YAML, unique ; une seule version courante", async () => {
    await assertViolation(assert, insertSimulator("Pas_Valide"), { code: CHECK, constraint: "simulators_slug_chk" });
    const id = await insertSimulator("paiement-mobile-generique");
    await assertViolation(assert, insertSimulator("paiement-mobile-generique"), { code: UNIQUE, constraint: "simulators_slug_uidx" });
    const addVersion = (v, current) =>
      q("INSERT INTO simulator_versions (simulator_id, version, yaml, is_current) VALUES ($1, $2, 'name: x', $3)", [id, v, current]);
    await addVersion("1.0.0", true);
    await addVersion("1.1.0", false);
    await assertViolation(assert, addVersion("1.2.0", true), { code: UNIQUE, constraint: "simulator_versions_one_current_uidx" });
    await assertViolation(assert, addVersion("1.0.0", false), { code: UNIQUE, constraint: "simulator_versions_simulator_version_uidx" });
    await assertViolation(assert, addVersion("v2", false), { code: CHECK, constraint: "simulator_versions_semver_chk" });
    await assertViolation(
      assert,
      q("INSERT INTO simulator_versions (simulator_id, version, yaml) VALUES ($1, '9.9.9', $2)", [id, "x".repeat(65537)]),
      { code: CHECK, constraint: "simulator_versions_yaml_size_chk" },
    );
  });

  test("project_simulators.active_scenario_key : NULL = nominal ; '' et espaces refusés ; 1 à 60 caractères", async () => {
    const user = await insertUser();
    const projectId = await insertProject(user.id);
    const simId = await insertSimulator();
    await q("INSERT INTO project_simulators (project_id, simulator_id) VALUES ($1, $2)", [projectId, simId]);
    const set = (v) => q("UPDATE project_simulators SET active_scenario_key = $3 WHERE project_id = $1 AND simulator_id = $2", [projectId, simId, v]);
    await set(null);
    await set("solde-insuffisant");
    await set("x".repeat(60));
    for (const bad of ["", " solde", "solde ", "x".repeat(61)]) {
      await assertViolation(assert, set(bad), { code: CHECK, constraint: "project_simulators_active_scenario_key_chk" });
    }
  });

  test("request_logs : aucun code HTTP inventé pour une requête sans réponse", async () => {
    const user = await insertUser();
    const projectId = await insertProject(user.id);
    await insertLog(logRow(projectId));
    await insertLog(logRow(projectId, { outcome: "client_aborted", status: null, response: null, error_code: "client_closed" }));
    await insertLog(logRow(projectId, { channel: "ussd", method: "USSD", path: "*123#", status: null }));
    await assertViolation(assert, insertLog(logRow(projectId, { status: null })), { code: CHECK, constraint: "request_logs_http_status_matches_outcome_chk" });
    await assertViolation(
      assert,
      insertLog(logRow(projectId, { outcome: "client_aborted", status: 499, response: null })),
      { code: CHECK, constraint: "request_logs_http_status_matches_outcome_chk" },
    );
    await assertViolation(
      assert,
      insertLog(logRow(projectId, { outcome: "timeout", status: null })),
      { code: CHECK, constraint: "request_logs_response_only_if_responded_chk" },
    );
    // status et response à NULL pour que seule la contrainte sur outcome soit en cause.
    await assertViolation(
      assert,
      insertLog(logRow(projectId, { outcome: "inconnu", status: null, response: null })),
      { code: CHECK, constraint: "request_logs_outcome_chk" },
    );
    await assertViolation(assert, insertLog(logRow(projectId, { error_code: "Pas Valide" })), { code: CHECK, constraint: "request_logs_error_code_chk" });
    const rid = randomUUID();
    await insertLog(logRow(projectId, { request_id: rid }));
    await assertViolation(assert, insertLog(logRow(projectId, { request_id: rid })), { code: UNIQUE, constraint: "request_logs_request_id_uidx" });
  });

  test("request_logs.id : BIGINT renvoyé en chaîne par le pilote, jamais arrondi", async () => {
    const user = await insertUser();
    const projectId = await insertProject(user.id);
    const { rows } = await insertLog(logRow(projectId));
    assert.equal(typeof rows[0].id, "string");
    const { rows: big } = await q("SELECT 9007199254740993::bigint AS id");
    assert.equal(big[0].id, "9007199254740993");
  });

  test("suppressions : un utilisateur emporte ses projets, clés, journaux et sessions ; ses simulateurs survivent", async () => {
    const user = await insertUser();
    const projectId = await insertProject(user.id);
    const k = generateApiKey();
    await q("INSERT INTO api_keys (project_id, key_hash, prefix, last4, created_by) VALUES ($1, $2, $3, $4, $5)", [projectId, k.hash, k.prefix, k.last4, user.id]);
    await insertLog(logRow(projectId));
    await q("INSERT INTO sessions (token, expires_at, user_id, updated_at) VALUES ($1, now() + interval '1 day', $2, now())", [randomUUID(), user.id]);
    const simId = await insertSimulator(undefined, user.id);
    const forkId = await insertSimulator();
    await q("UPDATE simulators SET forked_from_id = $1 WHERE id = $2", [simId, forkId]);
    await q("INSERT INTO project_simulators (project_id, simulator_id) VALUES ($1, $2)", [projectId, simId]);

    await q("DELETE FROM users WHERE id = $1", [user.id]);

    const count = async (sql, p) => (await q(sql, p)).rows[0].n;
    assert.equal(await count("SELECT count(*)::int AS n FROM projects WHERE id = $1", [projectId]), 0);
    assert.equal(await count("SELECT count(*)::int AS n FROM api_keys WHERE project_id = $1", [projectId]), 0);
    assert.equal(await count("SELECT count(*)::int AS n FROM request_logs WHERE project_id = $1", [projectId]), 0);
    assert.equal(await count("SELECT count(*)::int AS n FROM sessions WHERE user_id = $1", [user.id]), 0);
    assert.equal(await count("SELECT count(*)::int AS n FROM project_simulators WHERE simulator_id = $1", [simId]), 0);
    const { rows } = await q("SELECT owner_id FROM simulators WHERE id = $1", [simId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].owner_id, null);
  });

  test("suppressions : un simulateur supprimé (brouillon) emporte ses versions ; les forks et journaux survivent", async () => {
    const user = await insertUser();
    const projectId = await insertProject(user.id);
    const simId = await insertSimulator();
    const { rows: v } = await q("INSERT INTO simulator_versions (simulator_id, version, yaml, is_current) VALUES ($1, '1.0.0', 'name: x', true) RETURNING id", [simId]);
    const forkId = await insertSimulator();
    await q("UPDATE simulators SET forked_from_id = $1 WHERE id = $2", [simId, forkId]);
    const { rows: log } = await insertLog(logRow(projectId, { simulator_id: simId, simulator_version_id: v[0].id }));

    await q("DELETE FROM simulators WHERE id = $1", [simId]);

    assert.equal((await q("SELECT count(*)::int AS n FROM simulator_versions WHERE simulator_id = $1", [simId])).rows[0].n, 0);
    assert.equal((await q("SELECT forked_from_id FROM simulators WHERE id = $1", [forkId])).rows[0].forked_from_id, null);
    const { rows: kept } = await q("SELECT simulator_id, simulator_version_id, simulator_slug FROM request_logs WHERE id = $1", [log[0].id]);
    assert.equal(kept[0].simulator_id, null);
    assert.equal(kept[0].simulator_version_id, null);
    assert.equal(kept[0].simulator_slug, "paiement-mobile-generique");
  });

  test("request_logs.session_id (D14) : NULL accepté, session valide enregistrée", async () => {
    const user = await insertUser();
    const projectId = await insertProject(user.id);
    const { rows: withoutSession } = await insertLog(logRow(projectId));
    const { rows: plain } = await q("SELECT session_id FROM request_logs WHERE id = $1", [withoutSession[0].id]);
    assert.equal(plain[0].session_id, null, "NULL pour une requête HTTP sans session");
    const sessionId = randomUUID();
    const { rows: ussd } = await insertLog(
      logRow(projectId, { channel: "ussd", method: "USSD", path: "*123#", status: null, session_id: sessionId }),
    );
    const { rows: stored } = await q("SELECT session_id FROM request_logs WHERE id = $1", [ussd[0].id]);
    assert.equal(stored[0].session_id, sessionId);
  });

  test("request_logs.session_id (D14) : recherche par (project_id, session_id), sans fuite entre projets", async () => {
    const user = await insertUser();
    const projectA = await insertProject(user.id);
    const projectB = await insertProject(user.id);
    const session = `ussd-${randomUUID()}`;
    for (let i = 0; i < 3; i++) {
      await insertLog(logRow(projectA, { channel: "ussd", method: "USSD", path: "*123#", status: null, session_id: session }));
    }
    await insertLog(logRow(projectA, { channel: "ussd", method: "USSD", path: "*123#", status: null, session_id: `autre-${randomUUID()}` }));
    await insertLog(logRow(projectB, { channel: "ussd", method: "USSD", path: "*123#", status: null, session_id: session }));
    await insertLog(logRow(projectA));
    const { rows } = await q(
      "SELECT id, project_id FROM request_logs WHERE project_id = $1 AND session_id = $2 ORDER BY id",
      [projectA, session],
    );
    assert.equal(rows.length, 3, "les 3 échanges de la session, et seulement eux");
    assert.ok(rows.every((r) => r.project_id === projectA));
    const ids = rows.map((r) => BigInt(r.id));
    assert.ok(ids[0] < ids[1] && ids[1] < ids[2], "ordre des échanges conservé par id croissant");
  });

  test("request_logs.session_id (D14) : index composite (project_id, session_id) présent et utilisable", async () => {
    const { rows: idx } = await q(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'request_logs' AND indexname = 'request_logs_project_session_idx'",
    );
    assert.equal(idx.length, 1, "index présent");
    assert.match(idx[0].indexdef, /USING btree \(project_id, session_id\)$/);
    await q("BEGIN");
    try {
      await q("SET LOCAL enable_seqscan = off");
      const { rows: plan } = await q(
        "EXPLAIN SELECT id FROM request_logs WHERE project_id = $1 AND session_id = $2",
        [randomUUID(), "s"],
      );
      assert.ok(plan.some((r) => r["QUERY PLAN"].includes("request_logs_project_session_idx")), "le planificateur peut utiliser l'index");
    } finally {
      await q("ROLLBACK");
    }
  });

  // A5 : historique des webhooks (une ligne par tentative, A-5).
  const deliveryRow = (projectId, over = {}) => ({
    delivery_id: randomUUID(), project_id: projectId, request_id: randomUUID(), event: "checkout.completed", attempt: 1,
    outcome: "success", status_code: 200, duration_ms: 12, destination_host: "hooks.exemple.test", ...over,
  });
  async function insertDelivery(row) {
    const cols = Object.keys(row);
    return q(`INSERT INTO webhook_deliveries (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, Object.values(row));
  }

  test("webhook_deliveries : issues valides ; un code HTTP seulement si une réponse a été reçue", async () => {
    const user = await insertUser();
    const projectId = await insertProject(user.id);
    await insertDelivery(deliveryRow(projectId));
    await insertDelivery(deliveryRow(projectId, { outcome: "http_error", status_code: 500, attempt: 2 }));
    await insertDelivery(deliveryRow(projectId, { outcome: "http_error", status_code: 302 }));
    for (const outcome of ["network_error", "timeout", "blocked", "no_secret"]) {
      await insertDelivery(deliveryRow(projectId, { outcome, status_code: null }));
    }
    await insertDelivery(deliveryRow(projectId, { outcome: "no_url", status_code: null, destination_host: null, duration_ms: 0 }));
    await insertDelivery(deliveryRow(projectId, { request_id: null }));

    const v = (over, constraint) => assertViolation(assert, insertDelivery(deliveryRow(projectId, over)), { code: CHECK, constraint });
    await v({ status_code: null }, "webhook_deliveries_status_matches_outcome_chk");
    await v({ outcome: "network_error", status_code: 502 }, "webhook_deliveries_status_matches_outcome_chk");
    await v({ outcome: "success", status_code: 500 }, "webhook_deliveries_success_2xx_chk");
    await v({ outcome: "http_error", status_code: 204 }, "webhook_deliveries_http_error_not_2xx_chk");
    await v({ outcome: "inconnu", status_code: null }, "webhook_deliveries_outcome_chk");
    await v({ outcome: "http_error", status_code: 99 }, "webhook_deliveries_status_code_range_chk");
    await v({ attempt: 0 }, "webhook_deliveries_attempt_chk");
    await v({ attempt: 11 }, "webhook_deliveries_attempt_chk");
    await v({ event: "" }, "webhook_deliveries_event_chk");
    await v({ duration_ms: -1 }, "webhook_deliveries_duration_chk");
    await v({ destination_host: "" }, "webhook_deliveries_destination_host_chk");
    await v({ destination_host: "a".repeat(254) }, "webhook_deliveries_destination_host_chk");
    await assertViolation(assert, insertDelivery(deliveryRow(projectId, { event: null })), { code: NOT_NULL });
  });

  test("webhook_deliveries : une tentative n'est enregistrée qu'une fois ; uuid et projet existant obligatoires", async () => {
    const user = await insertUser();
    const projectId = await insertProject(user.id);
    const deliveryId = randomUUID();
    await insertDelivery(deliveryRow(projectId, { delivery_id: deliveryId, attempt: 1, outcome: "timeout", status_code: null }));
    await insertDelivery(deliveryRow(projectId, { delivery_id: deliveryId, attempt: 2 }));
    await assertViolation(assert, insertDelivery(deliveryRow(projectId, { delivery_id: deliveryId, attempt: 2 })), {
      code: UNIQUE,
      constraint: "webhook_deliveries_delivery_attempt_uidx",
    });
    await assert.rejects(insertDelivery(deliveryRow(projectId, { delivery_id: "pas-un-uuid" })), (e) => e.code === "22P02");
    await assert.rejects(insertDelivery(deliveryRow(projectId, { request_id: "req-1" })), (e) => e.code === "22P02");
    await assert.rejects(insertDelivery(deliveryRow(randomUUID())), (e) => e.code === "23503", "projet inexistant refusé (clé étrangère)");
  });

  test("webhook_deliveries : supprimés avec leur projet (cascade) ; aucune colonne pour l'URL, le corps ou le secret", async () => {
    const user = await insertUser();
    const projectId = await insertProject(user.id);
    const other = await insertProject(user.id);
    await insertDelivery(deliveryRow(projectId));
    await insertDelivery(deliveryRow(other));
    const { rows: cols } = await q(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'webhook_deliveries' ORDER BY ordinal_position",
    );
    assert.deepEqual(cols.map((c) => c.column_name), [
      "id", "delivery_id", "project_id", "request_id", "event", "attempt", "outcome", "status_code", "duration_ms",
      "destination_host", "created_at",
    ]);
    await q("DELETE FROM projects WHERE id = $1", [projectId]);
    const count = async (id) => (await q("SELECT count(*)::int AS n FROM webhook_deliveries WHERE project_id = $1", [id])).rows[0].n;
    assert.equal(await count(projectId), 0);
    assert.equal(await count(other), 1, "les autres projets ne sont pas touchés");
    const { rows: idx } = await q(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'webhook_deliveries' AND indexname = 'webhook_deliveries_project_id_id_idx'",
    );
    assert.equal(idx.length, 1, "index de la console (project_id, id DESC)");
  });
});
