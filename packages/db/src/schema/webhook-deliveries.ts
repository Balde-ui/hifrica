import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects.js";
import { timestamptz } from "./columns.js";

/**
 * Issue d'une tentative de webhook (A-5, étendu par A5) :
 * - success       : réponse 2xx ;
 * - http_error    : autre code HTTP (3xx compris : aucune redirection n'est suivie) ;
 * - network_error : connexion impossible ou coupée ;
 * - timeout       : pas de réponse dans le délai ;
 * - blocked       : destination refusée (SSRF, schéma interdit) ;
 * - no_url        : le projet n'a pas d'URL de webhook (rien n'est envoyé) ;
 * - no_secret     : secret du projet indéchiffrable (WEBHOOK_SECRET_KEYS absente ou invalide) : rien n'est envoyé.
 */
export const WEBHOOK_OUTCOMES = ["success", "http_error", "network_error", "timeout", "blocked", "no_url", "no_secret"] as const;
export type WebhookOutcome = (typeof WEBHOOK_OUTCOMES)[number];

/**
 * Historique des webhooks (écrit par le moteur, A5 ; lu par la console). Une ligne par tentative.
 * Jamais l'URL complète (qui peut contenir un jeton), le corps, le secret ni la signature : seulement l'hôte.
 * delivery_id = identifiant du job BullMQ = X-Hifrica-Delivery, identique pour toutes les tentatives d'un envoi.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    deliveryId: uuid("delivery_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    requestId: uuid("request_id"),
    event: text("event").notNull(),
    attempt: smallint("attempt").notNull(),
    outcome: text("outcome", { enum: WEBHOOK_OUTCOMES }).notNull(),
    statusCode: smallint("status_code"),
    durationMs: integer("duration_ms").notNull(),
    destinationHost: text("destination_host"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Une tentative n'est enregistrée qu'une fois (rejeu d'un job BullMQ bloqué compris).
    uniqueIndex("webhook_deliveries_delivery_attempt_uidx").on(t.deliveryId, t.attempt),
    // Console : les dernières tentatives d'un projet.
    index("webhook_deliveries_project_id_id_idx").on(t.projectId, t.id.desc()),
    index("webhook_deliveries_created_at_idx").on(t.createdAt),
    check(
      "webhook_deliveries_outcome_chk",
      sql`${t.outcome} IN ('success', 'http_error', 'network_error', 'timeout', 'blocked', 'no_url', 'no_secret')`,
    ),
    check("webhook_deliveries_attempt_chk", sql`${t.attempt} BETWEEN 1 AND 10`),
    check("webhook_deliveries_status_code_range_chk", sql`${t.statusCode} IS NULL OR ${t.statusCode} BETWEEN 100 AND 599`),
    // Un code n'existe que si une réponse HTTP a été reçue : aucun code n'est inventé.
    check(
      "webhook_deliveries_status_matches_outcome_chk",
      sql`(${t.outcome} IN ('success', 'http_error')) = (${t.statusCode} IS NOT NULL)`,
    ),
    check("webhook_deliveries_success_2xx_chk", sql`${t.outcome} <> 'success' OR ${t.statusCode} BETWEEN 200 AND 299`),
    check("webhook_deliveries_http_error_not_2xx_chk", sql`${t.outcome} <> 'http_error' OR ${t.statusCode} NOT BETWEEN 200 AND 299`),
    check("webhook_deliveries_event_chk", sql`char_length(${t.event}) BETWEEN 1 AND 200`),
    check("webhook_deliveries_duration_chk", sql`${t.durationMs} >= 0`),
    // Un nom d'hôte DNS fait 253 caractères au plus ; une IPv6 littérale tient dans cette limite.
    check(
      "webhook_deliveries_destination_host_chk",
      sql`${t.destinationHost} IS NULL OR char_length(${t.destinationHost}) BETWEEN 1 AND 253`,
    ),
  ],
);
