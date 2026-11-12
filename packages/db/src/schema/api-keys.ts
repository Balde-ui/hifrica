import { sql } from "drizzle-orm";
import { check, customType, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { projects } from "./projects.js";
import { timestamptz } from "./columns.js";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * Clés de test sk_test_… : seule l'empreinte SHA-256 (32 octets) est stockée.
 * La clé complète n'est montrée qu'une fois, à la création. Une clé n'est jamais supprimée : revoked_at.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name"),
    keyHash: bytea("key_hash").notNull(),
    prefix: text("prefix").notNull(),
    last4: text("last4").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    lastUsedAt: timestamptz("last_used_at"),
    revokedAt: timestamptz("revoked_at"),
  },
  (t) => [
    uniqueIndex("api_keys_key_hash_uidx").on(t.keyHash),
    index("api_keys_project_id_idx").on(t.projectId),
    index("api_keys_project_active_idx").on(t.projectId).where(sql`${t.revokedAt} IS NULL`),
    check("api_keys_key_hash_len_chk", sql`octet_length(${t.keyHash}) = 32`),
    check("api_keys_prefix_chk", sql`${t.prefix} ~ '^sk_test_[0-9A-Za-z]{4}$'`),
    check("api_keys_last4_chk", sql`${t.last4} ~ '^[0-9A-Za-z]{4}$'`),
    check("api_keys_name_chk", sql`${t.name} IS NULL OR char_length(${t.name}) BETWEEN 1 AND 60`),
    check("api_keys_revoked_after_created_chk", sql`${t.revokedAt} IS NULL OR ${t.revokedAt} >= ${t.createdAt}`),
  ],
);
