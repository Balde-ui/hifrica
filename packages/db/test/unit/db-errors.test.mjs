// E1 — erreurs sûres. Utilise les VRAIES classes : DrizzleQueryError (drizzle-orm) et
// DatabaseError (pg), ainsi que le pino et le Fastify réellement installés pour apps/api.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { inspect } from "node:util";
import { DrizzleQueryError } from "drizzle-orm";
import pg from "pg";
import {
  DbOperationError,
  InvalidInputError,
  generateApiKey,
  isDbOperationError,
  safeDbCall,
  toSafeDbError,
} from "../../dist/index.js";

const PIN = "4821";
const { key: API_KEY, hash: KEY_HASH } = generateApiKey();
const KEY_HASH_HEX = KEY_HASH.toString("hex");
const WEBHOOK_SECRET = "whsec_" + "Z".repeat(43);
const BODY_SECRET = "corps-confidentiel-7f3a";

/** Vraie erreur PostgreSQL (classe pg.DatabaseError), avec tous les champs sensibles remplis. */
function pgError({ code, constraint, message, detail }) {
  const e = new pg.DatabaseError(message, 0, "error");
  Object.assign(e, {
    severity: "ERROR",
    code,
    constraint,
    detail,
    hint: `indice contenant ${PIN} et ${API_KEY}`,
    where: `contexte contenant ${WEBHOOK_SECRET}`,
    internalQuery: `SELECT '${BODY_SECRET}'`,
    table: "request_logs",
    schema: "public",
  });
  return e;
}

/** Vraie DrizzleQueryError : son message contient les paramètres, comme en production. */
function drizzleError(params, cause) {
  return new DrizzleQueryError('insert into "request_logs" ("request") values ($1)', params, cause);
}

/** Toutes les représentations d'une erreur qu'un appelant ou un journal pourrait produire. */
function representations(err) {
  return {
    message: err.message,
    stack: err.stack ?? "",
    json: JSON.stringify(err),
    jsonWrapped: JSON.stringify({ err, error: err }),
    inspect: inspect(err, { depth: 10, showHidden: true }),
    ownProps: JSON.stringify(Object.getOwnPropertyNames(err).map((k) => [k, String(err[k])])),
    string: String(err),
  };
}

function assertNoSecret(err, secrets) {
  for (const [where, text] of Object.entries(representations(err))) {
    for (const secret of secrets) assert.ok(!text.includes(secret), `secret présent dans ${where}`);
  }
  assert.equal(Object.hasOwn(err, "cause"), false, "aucune cause conservée");
  assert.equal(err.cause, undefined);
  for (const k of ["detail", "hint", "where", "internalQuery", "params", "query"]) assert.equal(Object.hasOwn(err, k), false, k);
}

const ALL_SECRETS = [PIN, API_KEY, KEY_HASH_HEX, WEBHOOK_SECRET, BODY_SECRET];

describe("toSafeDbError : erreurs Drizzle et PostgreSQL réelles", () => {
  test("témoin : l'erreur brute contient bien les secrets (le test sait détecter une fuite)", () => {
    const raw = drizzleError([JSON.stringify({ body: { pin: PIN } })], pgError({ code: "23514", message: "x", detail: `Failing row contains ({"pin": "${PIN}"})` }));
    assert.ok(raw.message.includes(PIN), "le message de DrizzleQueryError contient les paramètres");
    assert.ok(raw.cause.detail.includes(PIN));
  });

  test("PIN dans les paramètres SQL et dans detail → check_violation sans aucune donnée", () => {
    const raw = drizzleError(
      [JSON.stringify({ body: { action: "confirm", pin: PIN } }), BODY_SECRET],
      pgError({
        code: "23514",
        constraint: "request_logs_outcome_chk",
        message: 'new row for relation "request_logs" violates check constraint "request_logs_outcome_chk"',
        detail: `Failing row contains (1, {"body": {"pin": "${PIN}"}}, ${BODY_SECRET}).`,
      }),
    );
    const safe = toSafeDbError("insert_request_log", raw);
    assert.ok(safe instanceof DbOperationError);
    assert.equal(safe.kind, "check_violation");
    assert.equal(safe.sqlstate, "23514");
    assert.equal(safe.constraint, "request_logs_outcome_chk");
    assert.equal(safe.operation, "insert_request_log");
    assertNoSecret(safe, ALL_SECRETS);
  });

  test("clé d'API et empreinte dans les paramètres et detail → unique_violation sans aucune donnée", () => {
    const raw = drizzleError(
      [API_KEY, KEY_HASH],
      pgError({
        code: "23505",
        constraint: "api_keys_key_hash_uidx",
        message: 'duplicate key value violates unique constraint "api_keys_key_hash_uidx"',
        detail: `Key (key_hash)=(\\x${KEY_HASH_HEX}) already exists.`,
      }),
    );
    const safe = toSafeDbError("create_api_key", raw);
    assert.equal(safe.kind, "unique_violation");
    assert.equal(safe.sqlstate, "23505");
    assert.equal(safe.constraint, "api_keys_key_hash_uidx");
    assertNoSecret(safe, ALL_SECRETS);
  });

  test("secret de webhook dans les paramètres → foreign_key_violation sans aucune donnée", () => {
    const raw = drizzleError(
      [WEBHOOK_SECRET],
      pgError({ code: "23503", constraint: "projects_owner_id_users_id_fk", message: "insert or update violates foreign key", detail: `Key (owner_id)=(${WEBHOOK_SECRET}) is not present.` }),
    );
    const safe = toSafeDbError("create_project", raw);
    assert.equal(safe.kind, "foreign_key_violation");
    assert.equal(safe.constraint, "projects_owner_id_users_id_fk");
    assertNoSecret(safe, ALL_SECRETS);
  });

  test("message PostgreSQL contenant la valeur (22P02) → le message d'origine n'est jamais recopié", () => {
    const raw = drizzleError([API_KEY], pgError({ code: "22P02", message: `invalid input syntax for type uuid: "${API_KEY}"`, detail: undefined }));
    const safe = toSafeDbError("resolve_api_key", raw);
    assert.equal(safe.kind, "invalid_input");
    assert.equal(safe.sqlstate, "22P02");
    assert.equal(safe.constraint, undefined, "pas de contrainte hors violation d'intégrité");
    assertNoSecret(safe, ALL_SECRETS);
  });

  test("erreur pg directe (sans DrizzleQueryError) → convertie de la même façon", () => {
    const safe = toSafeDbError("raw_query", pgError({ code: "23502", constraint: "x", message: `null value ${PIN}`, detail: `Failing row contains (${PIN})` }));
    assert.equal(safe.kind, "not_null_violation");
    assertNoSecret(safe, ALL_SECRETS);
  });

  test("erreur réseau Node (ECONNREFUSED) → connection, sans hôte ni identifiants", () => {
    const net = Object.assign(new Error(`connect ECONNREFUSED postgres://hifrica:${BODY_SECRET}@db:5432`), { code: "ECONNREFUSED", errno: -111 });
    const safe = toSafeDbError("resolve_api_key", net);
    assert.equal(safe.kind, "connection");
    assert.equal(safe.sqlstate, undefined);
    assertNoSecret(safe, ALL_SECRETS);
  });
});

describe("toSafeDbError : erreurs inconnues et entrées hostiles", () => {
  const cases = [
    ["Error dont le message contient des secrets", new Error(`échec ${PIN} ${API_KEY} ${WEBHOOK_SECRET}`)],
    ["chaîne levée", `échec ${PIN} ${API_KEY}`],
    ["null", null],
    ["undefined", undefined],
    ["nombre", 42],
    ["objet sans code", { message: PIN, detail: API_KEY }],
    ["SQLSTATE non autorisé (XX000)", pgError({ code: "XX000", message: PIN, detail: API_KEY })],
    ["code forgé contenant un secret", Object.assign(new Error("x"), { code: API_KEY })],
    ["accesseur qui lève", Object.defineProperty(new Error(PIN), "code", { get() { throw new Error(API_KEY); } })],
    ["cause d'une erreur non Drizzle, sans code", Object.assign(new Error(PIN), { cause: new Error(API_KEY) })],
  ];
  for (const [label, err] of cases) {
    test(`${label} → unknown, aucune donnée`, () => {
      const safe = toSafeDbError("some_operation", err);
      assert.equal(safe.kind, "unknown");
      assert.equal(safe.sqlstate, undefined);
      assert.equal(safe.constraint, undefined);
      assertNoSecret(safe, ALL_SECRETS);
    });
  }

  test("nom de contrainte invalide → ignoré ; contrainte ignorée hors violation d'intégrité", () => {
    const a = toSafeDbError("op", pgError({ code: "23505", constraint: `x"; ${PIN}`, message: "m" }));
    assert.equal(a.kind, "unique_violation");
    assert.equal(a.constraint, undefined);
    const b = toSafeDbError("op", pgError({ code: "40001", constraint: "valid_name", message: "m" }));
    assert.equal(b.kind, "serialization_failure");
    assert.equal(b.constraint, undefined);
  });

  test("libellé d'opération invalide (contenant une valeur) → remplacé", () => {
    const safe = toSafeDbError(`resolve ${API_KEY}`, new Error("x"));
    assert.equal(safe.operation, "unknown_operation");
    assertNoSecret(safe, ALL_SECRETS);
  });

  test("une DbOperationError déjà sûre est reconstruite à l'identique (champs revalidés)", () => {
    const safe = new DbOperationError("resolve_api_key", "deadlock", "40P01");
    const again = toSafeDbError("touch_api_key", safe);
    assert.ok(again instanceof DbOperationError);
    assert.deepEqual(JSON.parse(JSON.stringify(again)), JSON.parse(JSON.stringify(safe)));
    assert.ok(isDbOperationError(safe));
    assert.equal(isDbOperationError(new Error("x")), false);
  });

  test("le constructeur filtre aussi un SQLSTATE ou une contrainte non autorisés", () => {
    const e = new DbOperationError("op", "unique_violation", "ZZ999", "bad name");
    assert.equal(e.sqlstate, undefined);
    assert.equal(e.constraint, undefined);
  });
});

describe("safeDbCall et exploitation par les appelants", () => {
  test("valeur renvoyée inchangée en cas de succès", async () => {
    assert.deepEqual(await safeDbCall("op", async () => ({ ok: 1 })), { ok: 1 });
  });

  test("rejet converti : l'appelant peut décider sur kind / sqlstate / constraint", async () => {
    const raw = drizzleError([API_KEY], pgError({ code: "23505", constraint: "api_keys_key_hash_uidx", message: "dup", detail: `Key (key_hash)=(\\x${KEY_HASH_HEX})` }));
    await assert.rejects(safeDbCall("create_api_key", async () => { throw raw; }), (err) => {
      assert.ok(err instanceof DbOperationError);
      assert.equal(err.kind, "unique_violation");
      assert.equal(err.constraint, "api_keys_key_hash_uidx");
      assertNoSecret(err, ALL_SECRETS);
      return true;
    });
  });

  test("JSON.stringify n'expose que les champs sûrs", () => {
    const safe = toSafeDbError("insert_request_log", drizzleError([PIN], pgError({ code: "23514", constraint: "request_logs_outcome_chk", message: PIN, detail: PIN })));
    assert.deepEqual(JSON.parse(JSON.stringify(safe)), {
      name: "DbOperationError",
      message: safe.message,
      operation: "insert_request_log",
      kind: "check_violation",
      sqlstate: "23514",
      constraint: "request_logs_outcome_chk",
    });
  });

  test("InvalidInputError : nomme le champ et la règle (liste fermée), jamais la valeur", () => {
    const e = new InvalidInputError("projectId", "must_be_uuid");
    assert.equal(e.message, "projectId : doit être un uuid");
    assert.deepEqual(JSON.parse(JSON.stringify(e)), { name: "InvalidInputError", message: e.message, field: "projectId", rule: "must_be_uuid" });
  });
});

// --- Journaux réels : pino et Fastify installés pour apps/api (aucune dépendance ajoutée à packages/db).
// P3 : ces tests sont OBLIGATOIRES. Si pino ou Fastify ne sont plus résolus depuis apps/api, ils
// ÉCHOUENT avec un message explicite au lieu d'être ignorés (la couverture de sécurité des journaux
// ne doit jamais disparaître en silence).
const LOGGER_DEPS_MESSAGE =
  "pino et Fastify doivent être résolus depuis apps/api (pnpm install à la racine) : " +
  "les tests de non-divulgation dans les journaux sont obligatoires et ne sont jamais ignorés";
let pino;
let Fastify;
let loggerLoadError;
try {
  const fromApi = createRequire(new URL("../../../../apps/api/package.json", import.meta.url));
  const fastifyPath = fromApi.resolve("fastify");
  Fastify = fromApi("fastify");
  pino = createRequire(fastifyPath)("pino");
  if (typeof Fastify !== "function" || typeof pino !== "function" || typeof pino.stdSerializers?.errWithCause !== "function") {
    throw new Error("export inattendu");
  }
} catch (e) {
  // Seul le code d'erreur Node (ex. MODULE_NOT_FOUND) est gardé, jamais un chemin complet.
  loggerLoadError = `${LOGGER_DEPS_MESSAGE} (cause : ${(e && typeof e.code === "string" && e.code) || "chargement impossible"})`;
  // Tout usage échoue avec le message explicite (pas de TypeError obscure, pas de test ignoré).
  const missing = new Proxy(function () {}, {
    get() { throw new Error(loggerLoadError); },
    apply() { throw new Error(loggerLoadError); },
  });
  pino = missing;
  Fastify = missing;
}

test("P3 : pino et Fastify sont disponibles pour les tests de journalisation", () => {
  assert.equal(loggerLoadError, undefined, loggerLoadError);
});

function capture() {
  const lines = [];
  return { lines, stream: { write: (s) => lines.push(s) }, text: () => lines.join("") };
}

describe("journaux réels (pino 10 / Fastify 5)", () => {
  const raw = () =>
    drizzleError(
      [JSON.stringify({ body: { pin: PIN } }), API_KEY, WEBHOOK_SECRET, BODY_SECRET],
      pgError({ code: "23514", constraint: "request_logs_outcome_chk", message: `violates ${PIN}`, detail: `Failing row contains (${PIN}, ${API_KEY})` }),
    );

  test("témoin : pino journalise les secrets d'une DrizzleQueryError brute", () => {
    const out = capture();
    pino({}, out.stream).error({ err: raw() }, "échec");
    assert.ok(out.text().includes(PIN), "fuite attendue sur l'erreur brute");
  });

  test("pino, sérialiseur par défaut : erreur convertie → aucun secret, champs sûrs présents", () => {
    const out = capture();
    const log = pino({}, out.stream);
    const safe = toSafeDbError("insert_request_log", raw());
    log.error({ err: safe }, "échec");
    log.error({ error: safe }, "échec (clé non sérialisée)");
    log.error(safe);
    for (const s of ALL_SECRETS) assert.ok(!out.text().includes(s), "secret dans le journal pino");
    const first = JSON.parse(out.lines[0]);
    assert.equal(first.err.kind, "check_violation");
    assert.equal(first.err.sqlstate, "23514");
    assert.equal(first.err.constraint, "request_logs_outcome_chk");
  });

  test("pino, sérialiseur errWithCause : aucun secret", () => {
    const out = capture();
    const log = pino({ serializers: { err: pino.stdSerializers.errWithCause } }, out.stream);
    log.error({ err: toSafeDbError("insert_request_log", raw()) }, "échec");
    for (const s of ALL_SECRETS) assert.ok(!out.text().includes(s));
  });

  test("Fastify réel : erreur levée par une route via safeDbCall → ni le journal ni la réponse ne contiennent de secret", async () => {
    const out = capture();
    const app = Fastify({ logger: { level: "info", stream: out.stream } });
    app.get("/x", async () => safeDbCall("resolve_api_key", async () => { throw raw(); }));
    const res = await app.inject({ method: "GET", url: "/x" });
    await app.close();
    assert.equal(res.statusCode, 500);
    for (const s of ALL_SECRETS) {
      assert.ok(!out.text().includes(s), "secret dans le journal Fastify");
      assert.ok(!res.body.includes(s), "secret dans la réponse HTTP");
    }
    assert.ok(out.text().includes("DbOperationError"), "l'erreur sûre est bien journalisée");
  });
});

// --- R4 : régressions issues de l'audit indépendant de E1 (R1 à R3).
import { DB_OPERATIONS, INPUT_RULES, UNKNOWN_FIELD, UNKNOWN_OPERATION } from "../../dist/index.js";

const HOSTILE_MESSAGE = `piège ${PIN} ${API_KEY} ${WEBHOOK_SECRET}`;
const R4_SECRETS = [PIN, API_KEY, WEBHOOK_SECRET, KEY_HASH_HEX, BODY_SECRET, "piège"];

/** Proxy dont getPrototypeOf lève : fait échouer `instanceof`. */
const prototypeTrap = () => new Proxy({}, { getPrototypeOf() { throw new Error(HOSTILE_MESSAGE); } });
/** Proxy dont toutes les opérations de lecture lèvent. */
const totalTrap = () =>
  new Proxy({}, {
    get() { throw new Error(HOSTILE_MESSAGE); },
    has() { throw new Error(HOSTILE_MESSAGE); },
    ownKeys() { throw new Error(HOSTILE_MESSAGE); },
    getOwnPropertyDescriptor() { throw new Error(HOSTILE_MESSAGE); },
    getPrototypeOf() { throw new Error(HOSTILE_MESSAGE); },
  });

describe("R1 : toSafeDbError ne lève jamais, même face à un objet hostile", () => {
  test("Proxy dont getPrototypeOf lève → unknown, aucun contenu du piège", () => {
    const safe = toSafeDbError("resolve_api_key", prototypeTrap());
    assert.ok(safe instanceof DbOperationError);
    assert.equal(safe.kind, "unknown");
    assert.equal(safe.operation, "resolve_api_key");
    assertNoSecret(safe, R4_SECRETS);
  });

  test("le même Proxy via safeDbCall → DbOperationError, jamais l'erreur du piège", async () => {
    await assert.rejects(safeDbCall("insert_request_log", async () => { throw prototypeTrap(); }), (err) => {
      assert.ok(err instanceof DbOperationError);
      assert.equal(err.kind, "unknown");
      assertNoSecret(err, R4_SECRETS);
      return true;
    });
  });

  test("Proxy dont toutes les lectures lèvent → unknown, aucun contenu", () => {
    const safe = toSafeDbError("touch_api_key", totalTrap());
    assert.equal(safe.kind, "unknown");
    assertNoSecret(safe, R4_SECRETS);
  });

  test("objet forgé avec le prototype de DbOperationError → reconstruit, propriétés hostiles écartées", () => {
    const forged = Object.create(DbOperationError.prototype);
    Object.assign(forged, { message: HOSTILE_MESSAGE, operation: `op ${PIN}`, kind: "pin", sqlstate: API_KEY, constraint: `c_${PIN}x`, detail: HOSTILE_MESSAGE });
    const safe = toSafeDbError("get_webhook_target", forged);
    assert.notEqual(safe, forged);
    assert.equal(safe.operation, UNKNOWN_OPERATION);
    assert.equal(safe.kind, "unknown");
    assert.equal(safe.sqlstate, undefined);
    assert.equal(safe.constraint, undefined);
    assertNoSecret(safe, R4_SECRETS);
  });

  test("libellé d'opération hostile (Proxy, objet dont toString lève) → unknown_operation sans lever", () => {
    const badOps = [totalTrap(), { toString() { throw new Error(HOSTILE_MESSAGE); } }, Symbol("x"), null];
    for (const op of badOps) {
      const safe = toSafeDbError(op, new Error(HOSTILE_MESSAGE));
      assert.equal(safe.operation, UNKNOWN_OPERATION);
      assertNoSecret(safe, R4_SECRETS);
    }
  });

  test("AggregateError avec code ECONNREFUSED → connection ; sans code → unknown ; aucun hôte ni secret", () => {
    const inner = [
      Object.assign(new Error(`connect ECONNREFUSED ::1:5432 ${BODY_SECRET}`), { code: "ECONNREFUSED" }),
      Object.assign(new Error(`connect ECONNREFUSED 127.0.0.1:5432 ${API_KEY}`), { code: "ECONNREFUSED" }),
    ];
    const withCode = Object.assign(new AggregateError(inner, HOSTILE_MESSAGE), { code: "ECONNREFUSED" });
    const withoutCode = new AggregateError(inner, HOSTILE_MESSAGE);
    const a = toSafeDbError("resolve_api_key", withCode);
    const b = toSafeDbError("resolve_api_key", withoutCode);
    assert.equal(a.kind, "connection");
    assert.equal(b.kind, "unknown");
    assertNoSecret(a, R4_SECRETS);
    assertNoSecret(b, R4_SECRETS);
  });
});

describe("R2 : InvalidInputError n'accepte que des identifiants contrôlés", () => {
  const sensitiveFields = [PIN, `pin${PIN}`, `projectId_${PIN}`, API_KEY, WEBHOOK_SECRET, `request.${PIN}`, "Projet", "a b", "", "x".repeat(41)];
  for (const field of sensitiveFields) {
    test(`field ${JSON.stringify(field.slice(0, 20))}… → remplacé par "${UNKNOWN_FIELD}"`, () => {
      const e = new InvalidInputError(field, "must_be_uuid");
      assert.equal(e.field, UNKNOWN_FIELD);
      assert.equal(e.message, `${UNKNOWN_FIELD} : doit être un uuid`);
      assertNoSecret(e, R4_SECRETS);
    });
  }

  const sensitiveRules = [`valeur ${PIN} refusée`, API_KEY, WEBHOOK_SECRET, "doit être un uuid", "__proto__", "toString", "constructor"];
  for (const rule of sensitiveRules) {
    test(`rule ${JSON.stringify(rule.slice(0, 20))}… → règle générique "invalid"`, () => {
      const e = new InvalidInputError("projectId", rule);
      assert.equal(e.rule, "invalid");
      assert.equal(e.message, "projectId : invalide");
      assertNoSecret(e, R4_SECRETS);
    });
  }

  test("valeurs non textuelles (Proxy, objet, nombre) → génériques, sans lever", () => {
    const e = new InvalidInputError(totalTrap(), totalTrap());
    assert.equal(e.field, UNKNOWN_FIELD);
    assert.equal(e.rule, "invalid");
    const f = new InvalidInputError(4821, { toString: () => API_KEY });
    assert.equal(f.field, UNKNOWN_FIELD);
    assert.equal(f.rule, "invalid");
    assertNoSecret(f, R4_SECRETS);
  });

  test("champs et règles conformes conservés (camelCase, chemin pointé, liste fermée)", () => {
    for (const field of ["projectId", "request.headers", "response.body.items", "durationMs"]) {
      assert.equal(new InvalidInputError(field, "required").field, field);
    }
    for (const rule of INPUT_RULES) assert.equal(new InvalidInputError("projectId", rule).rule, rule);
  });
});

describe("R3 : libellés d'opération pris dans une liste fermée", () => {
  const raw = () => pgError({ code: "23505", constraint: "api_keys_key_hash_uidx", message: "m", detail: "d" });
  const hostileLabels = [
    `verify_pin:${PIN}`,
    `insert_request_log:${PIN}`,
    `resolve_api_key ${API_KEY}`,
    API_KEY,
    `get_webhook_target.${KEY_HASH_HEX.slice(0, 16)}`,
    "lookup.0123456789abcdef",
    "insert_request_logs",
    "INSERT_REQUEST_LOG",
  ];
  for (const label of hostileLabels) {
    test(`libellé ${JSON.stringify(label.slice(0, 24))}… → "${UNKNOWN_OPERATION}"`, () => {
      const viaConvert = toSafeDbError(label, raw());
      const viaCtor = new DbOperationError(label, "deadlock", "40P01");
      for (const e of [viaConvert, viaCtor]) {
        assert.equal(e.operation, UNKNOWN_OPERATION);
        assertNoSecret(e, R4_SECRETS);
      }
    });
  }

  test("toutes les opérations prévues pour E3 à E6 sont conservées", () => {
    for (const op of DB_OPERATIONS) assert.equal(toSafeDbError(op, raw()).operation, op);
  });

  test("catégorie forgée dans le constructeur → unknown", () => {
    assert.equal(new DbOperationError("resolve_api_key", `pin ${PIN}`).kind, "unknown");
  });
});

describe("R4 : sérialisation et journalisation des erreurs converties", () => {
  test("pino (défaut et errWithCause) et Fastify : aucune donnée hostile dans les journaux ni la réponse", async () => {
    const errors = [
      toSafeDbError("resolve_api_key", prototypeTrap()),
      toSafeDbError(`verify_pin:${PIN}`, new Error(HOSTILE_MESSAGE)),
      new InvalidInputError(API_KEY, `valeur ${PIN}`),
      toSafeDbError("insert_request_log", Object.assign(new AggregateError([], HOSTILE_MESSAGE), { code: "ECONNREFUSED" })),
    ];
    for (const serializers of [{}, { serializers: { err: pino.stdSerializers.errWithCause } }]) {
      const out = capture();
      const log = pino(serializers, out.stream);
      for (const e of errors) {
        log.error({ err: e }, "échec");
        log.error({ error: e }, "échec");
        log.error(e);
      }
      for (const s of R4_SECRETS) assert.ok(!out.text().includes(s), "secret dans le journal pino");
    }
    const out = capture();
    const app = Fastify({ logger: { level: "info", stream: out.stream } });
    app.get("/proxy", async () => safeDbCall("resolve_api_key", async () => { throw prototypeTrap(); }));
    app.get("/input", async () => { throw new InvalidInputError(API_KEY, `valeur ${PIN}`); });
    const r1 = await app.inject({ method: "GET", url: "/proxy" });
    const r2 = await app.inject({ method: "GET", url: "/input" });
    await app.close();
    assert.equal(r1.statusCode, 500);
    for (const s of R4_SECRETS) {
      assert.ok(!out.text().includes(s), "secret dans le journal Fastify");
      assert.ok(!r1.body.includes(s) && !r2.body.includes(s), "secret dans une réponse HTTP");
    }
  });
});

describe("P2 : SQLSTATE de diagnostic reconnus, sans aucune donnée d'origine", () => {
  const USER = "utilisateur-confidentiel-91c2";
  const DB = "base-confidentielle-55aa";
  const TABLE = "table_confidentielle_3e9f";
  const cases = [
    { code: "42P01", kind: "schema_mismatch", message: `relation "${TABLE}" does not exist` },
    { code: "42703", kind: "schema_mismatch", message: `column "${TABLE}" of relation "request_logs" does not exist` },
    { code: "25P02", kind: "transaction_aborted", message: `current transaction is aborted (${PIN})` },
    { code: "28P01", kind: "authentication_failed", message: `password authentication failed for user "${USER}"` },
    { code: "28000", kind: "authentication_failed", message: `no pg_hba.conf entry for host "10.0.0.9", user "${USER}", database "${DB}"` },
    { code: "3D000", kind: "database_not_found", message: `database "${DB}" does not exist` },
  ];
  for (const c of cases) {
    test(`${c.code} → ${c.kind}, SQLSTATE conservé, message d'origine jamais recopié`, () => {
      const raw = pgError({ code: c.code, constraint: "request_logs_outcome_chk", message: c.message, detail: `${USER} ${DB}` });
      for (const err of [raw, drizzleError([PIN, API_KEY], raw)]) {
        const safe = toSafeDbError("resolve_api_key", err);
        assert.equal(safe.kind, c.kind);
        assert.equal(safe.sqlstate, c.code);
        assert.equal(safe.constraint, undefined, "aucune contrainte hors violation d'intégrité");
        assertNoSecret(safe, [...ALL_SECRETS, USER, DB, TABLE, "10.0.0.9"]);
      }
    });
  }

  test("un SQLSTATE hors liste (ex. 42601, erreur de syntaxe) reste unknown, sans code", () => {
    const safe = toSafeDbError("resolve_api_key", pgError({ code: "42601", message: `syntax error near "${PIN}"` }));
    assert.equal(safe.kind, "unknown");
    assert.equal(safe.sqlstate, undefined);
    assertNoSecret(safe, ALL_SECRETS);
  });

  test("les nouvelles catégories passent la revalidation d'une DbOperationError reconstruite", () => {
    for (const kind of ["schema_mismatch", "transaction_aborted", "authentication_failed", "database_not_found"]) {
      assert.equal(toSafeDbError("resolve_api_key", new DbOperationError("resolve_api_key", kind)).kind, kind);
    }
  });
});
