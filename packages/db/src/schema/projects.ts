import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { timestamps, timestamptz } from "./columns.js";

/**
 * Projet d'un développeur. Un seul propriétaire (les équipes sont un bonus du cahier).
 * Le secret de signature des webhooks n'est JAMAIS stocké en clair : webhook_secret_enc contient
 * le texte chiffré AES-256-GCM produit par crypto/webhook-secret.ts (format "v<n>:<iv>.<chiffré+tag>").
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    webhookUrl: text("webhook_url"),
    webhookSecretEnc: text("webhook_secret_enc").notNull(),
    webhookSecretRotatedAt: timestamptz("webhook_secret_rotated_at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    index("projects_owner_id_idx").on(t.ownerId),
    check("projects_name_chk", sql`char_length(${t.name}) BETWEEN 1 AND 80 AND ${t.name} = btrim(${t.name})`),
    check(
      "projects_webhook_url_chk",
      sql`${t.webhookUrl} IS NULL OR (${t.webhookUrl} ~ '^https?://' AND char_length(${t.webhookUrl}) <= 2048)`,
    ),
    check("projects_webhook_secret_enc_chk", sql`${t.webhookSecretEnc} ~ '^v[0-9]+:[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$'`),
  ],
);
