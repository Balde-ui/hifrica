// Erreurs sûres de la couche d'accès aux données.
//
// Pourquoi : une requête Drizzle en échec lève DrizzleQueryError, dont le message est
// « Failed query: <SQL> params: <TOUTES les valeurs> » ; l'erreur pg d'origine (cause) porte
// `detail` (ligne rejetée, valeurs de clés), `hint`, `where`, `internalQuery`, et son message peut
// lui-même contenir une valeur (« invalid input syntax for type uuid: "…" »). Journaliser l'une ou
// l'autre exposerait un PIN, une clé d'API, un secret ou un corps de requête.
//
// Règle : toute erreur venant de la base est convertie en DbOperationError, qui ne contient QUE
// des informations sûres et validées (libellé d'opération pris dans une liste fermée, catégorie,
// SQLSTATE autorisé, nom de contrainte). Le message d'origine n'est jamais lu ; aucune `cause`
// n'est conservée. La conversion elle-même ne peut pas lever (objets hostiles compris).
//
// Pourquoi aucune `cause` : `cause` garderait l'objet d'origine (DrizzleQueryError ou erreur pg).
// Or pino (sérialiseur `errWithCause`), `util.inspect` et Fastify parcourent `cause` et
// recopieraient alors son message, `params` et `detail`, c'est-à-dire exactement ce qu'on retire.
//
// Conséquence assumée pour le débogage : la pile (`stack`) d'une DbOperationError est celle de sa
// création, donc elle pointe vers toSafeDbError / safeDbCall et non vers la ligne qui a lancé la
// requête SQL. Pour situer l'échec, s'appuyer sur `operation` (liste fermée, une valeur par
// fonction d'accès) et sur la pile de l'appelant de safeDbCall, qui reste visible au-dessus.
import { DrizzleQueryError } from "drizzle-orm";

/** Catégorie stable, exploitable par les appelants (ex. 409 sur unique_violation). */
export type DbErrorKind =
  | "unique_violation"
  | "foreign_key_violation"
  | "check_violation"
  | "not_null_violation"
  | "invalid_input"
  | "serialization_failure"
  | "deadlock"
  | "lock_not_available"
  | "query_canceled"
  | "connection"
  | "schema_mismatch"
  | "transaction_aborted"
  | "authentication_failed"
  | "database_not_found"
  | "unknown";

const DB_ERROR_KINDS: ReadonlySet<string> = new Set<DbErrorKind>([
  "unique_violation",
  "foreign_key_violation",
  "check_violation",
  "not_null_violation",
  "invalid_input",
  "serialization_failure",
  "deadlock",
  "lock_not_available",
  "query_canceled",
  "connection",
  "schema_mismatch",
  "transaction_aborted",
  "authentication_failed",
  "database_not_found",
  "unknown",
]);

/**
 * Libellés d'opération autorisés (liste FERMÉE) : aucune valeur dynamique ne peut y entrer.
 * Opérations prévues par la conception C4 (E3 à E6). Toute nouvelle opération s'ajoute ici.
 */
export const DB_OPERATIONS = [
  "insert_request_log",
  "resolve_api_key",
  "touch_api_key",
  "get_webhook_target",
  "get_simulator_for_project",
  // C2 / C4 / C5 : routes de la plateforme (comptes, projets, clés, console, catalogue).
  "get_project_for_owner",
  "list_projects",
  "create_project",
  "get_project",
  "update_project",
  "list_api_keys",
  "create_api_key",
  "revoke_api_key",
  "set_active_scenario",
  "get_active_scenario",
  "list_request_logs",
  "seed_simulators",
  "list_simulators",
  "get_simulator",
  "publish_simulator",
] as const;
export type DbOperation = (typeof DB_OPERATIONS)[number];
/** Libellé utilisé quand l'opération fournie n'est pas dans la liste. */
export const UNKNOWN_OPERATION = "unknown_operation";

const DB_OPERATION_SET: ReadonlySet<string> = new Set<string>(DB_OPERATIONS);

/** SQLSTATE autorisés : seuls ceux-ci sont recopiés dans l'erreur sûre. */
const SQLSTATE_KINDS: Readonly<Record<string, DbErrorKind>> = Object.freeze({
  "23505": "unique_violation",
  "23503": "foreign_key_violation",
  "23514": "check_violation",
  "23502": "not_null_violation",
  "22P02": "invalid_input", // invalid_text_representation (ex. uuid mal formé)
  "22P05": "invalid_input", // untranslatable_character (ex. \u0000 dans un jsonb)
  "22001": "invalid_input", // string_data_right_truncation
  "22003": "invalid_input", // numeric_value_out_of_range
  "22007": "invalid_input", // invalid_datetime_format
  "22008": "invalid_input", // datetime_field_overflow
  "22021": "invalid_input", // character_not_in_repertoire
  "22023": "invalid_input", // invalid_parameter_value
  "40001": "serialization_failure",
  "40P01": "deadlock",
  "55P03": "lock_not_available",
  "57014": "query_canceled",
  "08000": "connection",
  "08001": "connection",
  "08003": "connection",
  "08004": "connection",
  "08006": "connection",
  "53300": "connection", // too_many_connections
  "57P01": "connection", // admin_shutdown
  "57P02": "connection", // crash_shutdown
  "57P03": "connection", // cannot_connect_now
  // Codes de diagnostic sans donnée : seul le code est gardé. Leurs messages PostgreSQL nomment la
  // table, la colonne, l'utilisateur ou la base (« password authentication failed for user "…" ») :
  // ils ne sont JAMAIS lus, comme pour tous les autres codes.
  "42P01": "schema_mismatch", // undefined_table (typiquement : migration non appliquée)
  "42703": "schema_mismatch", // undefined_column
  "25P02": "transaction_aborted", // in_failed_sql_transaction
  "28P01": "authentication_failed", // invalid_password
  "28000": "authentication_failed", // invalid_authorization_specification (ex. refus pg_hba)
  "3D000": "database_not_found", // invalid_catalog_name
});

/** Codes d'erreur réseau Node.js (sans donnée) ramenés à la catégorie "connection". */
const NETWORK_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "EAI_AGAIN",
]);

/** Le nom de contrainte n'est conservé que pour les violations d'intégrité. */
const CONSTRAINT_KINDS: ReadonlySet<DbErrorKind> = new Set([
  "unique_violation",
  "foreign_key_violation",
  "check_violation",
  "not_null_violation",
]);

const CONSTRAINT_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

/** Ne renvoie que des valeurs issues d'ensembles fermés ; ne lève jamais. */
function safeOperation(operation: unknown): string {
  return typeof operation === "string" && DB_OPERATION_SET.has(operation) ? operation : UNKNOWN_OPERATION;
}

function safeKind(kind: unknown): DbErrorKind {
  return typeof kind === "string" && DB_ERROR_KINDS.has(kind) ? (kind as DbErrorKind) : "unknown";
}

/** Lecture défensive d'une propriété texte (un accesseur peut lever, une valeur peut ne pas être une chaîne). */
function readString(source: unknown, key: string): string | undefined {
  if (source === null || (typeof source !== "object" && typeof source !== "function")) return undefined;
  try {
    const value = (source as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** DrizzleQueryError → erreur pg d'origine ; sinon l'erreur elle-même (ou sa cause si elle seule a un code). */
function underlyingError(err: unknown): unknown {
  if (err instanceof DrizzleQueryError) return err.cause;
  if (readString(err, "code") === undefined && err !== null && typeof err === "object") {
    try {
      const cause = (err as { cause?: unknown }).cause;
      if (readString(cause, "code") !== undefined) return cause;
    } catch {
      return err;
    }
  }
  return err;
}

/**
 * Erreur de base de données sans aucune donnée sensible : seuls des champs validés sont présents.
 * Volontairement sans `cause`, et sa pile pointe vers toSafeDbError (voir l'en-tête du fichier).
 */
export class DbOperationError extends Error {
  override readonly name = "DbOperationError";
  /** Libellé de la liste fermée DB_OPERATIONS, ou "unknown_operation". */
  readonly operation: string;
  readonly kind: DbErrorKind;
  /** SQLSTATE PostgreSQL, uniquement s'il figure dans la liste autorisée. */
  readonly sqlstate: string | undefined;
  /** Nom de contrainte validé, uniquement pour les violations d'intégrité. */
  readonly constraint: string | undefined;

  constructor(operation: DbOperation | string, kind: DbErrorKind, sqlstate?: string, constraint?: string) {
    const op = safeOperation(operation);
    const k = safeKind(kind);
    const state = typeof sqlstate === "string" && Object.hasOwn(SQLSTATE_KINDS, sqlstate) ? sqlstate : undefined;
    const name =
      typeof constraint === "string" && CONSTRAINT_KINDS.has(k) && CONSTRAINT_PATTERN.test(constraint) ? constraint : undefined;
    const details = [k, state && `SQLSTATE ${state}`, name && `contrainte ${name}`].filter(Boolean).join(", ");
    super(`${op} : échec de la base de données (${details})`);
    this.operation = op;
    this.kind = k;
    this.sqlstate = state;
    this.constraint = name;
  }

  /** Sérialisation explicite : uniquement les champs sûrs (JSON.stringify, journaux). */
  toJSON(): { name: string; message: string; operation: string; kind: DbErrorKind; sqlstate?: string; constraint?: string } {
    return {
      name: this.name,
      message: this.message,
      operation: this.operation,
      kind: this.kind,
      ...(this.sqlstate !== undefined ? { sqlstate: this.sqlstate } : {}),
      ...(this.constraint !== undefined ? { constraint: this.constraint } : {}),
    };
  }
}

function convert(operation: unknown, err: unknown): DbOperationError {
  // Même une DbOperationError est reconstruite à partir de ses champs relus et revalidés :
  // un objet forgé (prototype DbOperationError, propriétés arbitraires) ne passe donc pas tel quel.
  if (err instanceof DbOperationError) {
    return new DbOperationError(
      readString(err, "operation") ?? UNKNOWN_OPERATION,
      safeKind(readString(err, "kind")),
      readString(err, "sqlstate"),
      readString(err, "constraint"),
    );
  }
  const source = underlyingError(err);
  const code = readString(source, "code");
  if (code !== undefined && Object.hasOwn(SQLSTATE_KINDS, code)) {
    return new DbOperationError(safeOperation(operation), SQLSTATE_KINDS[code], code, readString(source, "constraint"));
  }
  if (code !== undefined && NETWORK_CODES.has(code)) {
    return new DbOperationError(safeOperation(operation), "connection");
  }
  return new DbOperationError(safeOperation(operation), "unknown");
}

/**
 * Convertit n'importe quelle erreur levée lors d'un accès à la base en DbOperationError.
 * Ne lit jamais message, params, query, detail, hint, where ni internalQuery ; ne conserve pas `cause`.
 * Ne lève jamais : si l'inspection de l'erreur échoue (Proxy hostile, `instanceof` qui lève…),
 * le repli est une erreur "unknown" construite sans aucune donnée de l'objet reçu.
 */
export function toSafeDbError(operation: DbOperation | string, err: unknown): DbOperationError {
  try {
    return convert(operation, err);
  } catch {
    try {
      return new DbOperationError(safeOperation(operation), "unknown");
    } catch {
      return new DbOperationError(UNKNOWN_OPERATION, "unknown");
    }
  }
}

/** Exécute un accès à la base et garantit qu'aucune erreur brute n'en sort. */
export async function safeDbCall<T>(operation: DbOperation, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toSafeDbError(operation, err);
  }
}

export function isDbOperationError(value: unknown): value is DbOperationError {
  try {
    return value instanceof DbOperationError;
  } catch {
    return false;
  }
}

/** Règles de validation (liste FERMÉE) et leur libellé lisible. */
const INPUT_RULE_MESSAGES = Object.freeze({
  required: "valeur obligatoire",
  must_be_string: "doit être une chaîne",
  must_be_uuid: "doit être un uuid",
  must_be_integer: "doit être un entier",
  must_be_boolean: "doit être un booléen",
  must_be_null: "doit être nul",
  must_be_object: "doit être un objet",
  out_of_range: "hors de la plage autorisée",
  too_long: "trop long",
  invalid_format: "format invalide",
  not_allowed: "valeur non autorisée",
  inconsistent: "incohérent avec les autres champs",
  unserializable: "valeur non sérialisable",
  invalid: "invalide",
} as const);
export type InputRule = keyof typeof INPUT_RULE_MESSAGES;
export const INPUT_RULES = Object.freeze(Object.keys(INPUT_RULE_MESSAGES)) as readonly InputRule[];

/** Nom de champ : identifiant camelCase, éventuellement pointé (ex. "request.headers"), sans chiffre ni « _ ». */
const FIELD_PATTERN = /^[a-z][a-zA-Z]{0,39}(\.[a-z][a-zA-Z]{0,39}){0,3}$/;
/** Nom utilisé quand le champ fourni ne respecte pas la convention. */
export const UNKNOWN_FIELD = "field";

/** Entrée invalide : champ et règle contrôlés, jamais la valeur reçue (ni aucune chaîne arbitraire). */
export class InvalidInputError extends Error {
  override readonly name = "InvalidInputError";
  readonly field: string;
  readonly rule: InputRule;

  constructor(field: string, rule: InputRule) {
    const f = typeof field === "string" && FIELD_PATTERN.test(field) ? field : UNKNOWN_FIELD;
    const r: InputRule = typeof rule === "string" && Object.hasOwn(INPUT_RULE_MESSAGES, rule) ? rule : "invalid";
    super(`${f} : ${INPUT_RULE_MESSAGES[r]}`);
    this.field = f;
    this.rule = r;
  }

  toJSON(): { name: string; message: string; field: string; rule: InputRule } {
    return { name: this.name, message: this.message, field: this.field, rule: this.rule };
  }
}
