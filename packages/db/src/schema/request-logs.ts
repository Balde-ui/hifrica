import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { apiKeys } from "./api-keys.js";
import { projects } from "./projects.js";
import { simulators, simulatorVersions } from "./simulators.js";
import { timestamptz } from "./columns.js";

export const REQUEST_CHANNELS = ["http", "ussd", "sms"] as const;
export const REQUEST_SOURCES = ["api", "replay", "editor", "phone"] as const;
/**
 * Issue réelle de la requête, indépendante du code HTTP :
 * - responded       : une réponse complète a été envoyée (status = code réellement envoyé) ;
 * - client_aborted  : le client a coupé avant la réponse (status NULL) ;
 * - response_failed : l'écriture de la réponse a échoué (status NULL) ;
 * - timeout         : délai du serveur dépassé avant toute réponse (status NULL).
 */
export const REQUEST_OUTCOMES = ["responded", "client_aborted", "response_failed", "timeout"] as const;

/**
 * Journal des requêtes adressées aux simulateurs (écrit par le moteur, lu par la console). Purge à 7 jours.
 * id : BIGINT manipulé en BigInt côté JS, transmis en chaîne hors du serveur (voir ids.ts).
 * request/response : déjà MASQUÉS avant insertion (Authorization, cookies, sk_test_…).
 */
export const requestLogs = pgTable(
  "request_logs",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    requestId: uuid("request_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    simulatorId: uuid("simulator_id").references(() => simulators.id, { onDelete: "set null" }),
    simulatorVersionId: uuid("simulator_version_id").references(() => simulatorVersions.id, { onDelete: "set null" }),
    simulatorSlug: text("simulator_slug").notNull(),
    channel: text("channel", { enum: REQUEST_CHANNELS }).notNull().default("http"),
    source: text("source", { enum: REQUEST_SOURCES }).notNull().default("api"),
    outcome: text("outcome", { enum: REQUEST_OUTCOMES }).notNull(),
    endpointId: text("endpoint_id"),
    scenarioKey: text("scenario_key"),
    method: text("method").notNull(),
    path: text("path").notNull(),
    status: smallint("status"),
    errorCode: text("error_code"),
    durationMs: integer("duration_ms").notNull(),
    request: jsonb("request").notNull(),
    response: jsonb("response"),
    truncated: boolean("truncated").notNull().default(false),
    replayOfId: bigint("replay_of_id", { mode: "bigint" }).references((): AnyPgColumn => requestLogs.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("request_logs_request_id_uidx").on(t.requestId),
    index("request_logs_project_id_id_idx").on(t.projectId, t.id.desc()),
    index("request_logs_created_at_idx").on(t.createdAt),
    check("request_logs_channel_chk", sql`${t.channel} IN ('http', 'ussd', 'sms')`),
    check("request_logs_source_chk", sql`${t.source} IN ('api', 'replay', 'editor', 'phone')`),
    check("request_logs_outcome_chk", sql`${t.outcome} IN ('responded', 'client_aborted', 'response_failed', 'timeout')`),
    check("request_logs_status_range_chk", sql`${t.status} IS NULL OR ${t.status} BETWEEN 100 AND 599`),
    // En HTTP, un code n'existe que si une réponse complète a été envoyée : aucun code n'est inventé.
    check(
      "request_logs_http_status_matches_outcome_chk",
      sql`${t.channel} <> 'http' OR ((${t.outcome} = 'responded') = (${t.status} IS NOT NULL))`,
    ),
    check("request_logs_response_only_if_responded_chk", sql`${t.outcome} = 'responded' OR ${t.response} IS NULL`),
    check("request_logs_error_code_chk", sql`${t.errorCode} IS NULL OR ${t.errorCode} ~ '^[a-z][a-z0-9_.]{0,63}$'`),
    check("request_logs_method_chk", sql`char_length(${t.method}) BETWEEN 1 AND 10`),
    check("request_logs_path_chk", sql`char_length(${t.path}) <= 2048`),
    check("request_logs_duration_chk", sql`${t.durationMs} >= 0`),
  ],
);
