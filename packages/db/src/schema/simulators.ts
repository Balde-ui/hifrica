import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { timestamps, timestamptz } from "./columns.js";

export const SIMULATOR_KINDS = ["http", "ussd"] as const;
export const SIMULATOR_ORIGINS = ["manual", "ai"] as const;
export const SIMULATOR_STATUSES = ["draft", "to_verify", "verified", "unpublished"] as const;

/**
 * Catalogue. slug = champ `name` du YAML (même motif que packages/shared/src/schema.ts) ;
 * il sert dans l'URL sim.<domaine>/<slug>/…
 * Un simulateur publié n'est pas supprimé : il passe à `unpublished` (règle applicative).
 */
export const simulators = pgTable(
  "simulators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind", { enum: SIMULATOR_KINDS }).notNull(),
    description: text("description"),
    origin: text("origin", { enum: SIMULATOR_ORIGINS }).notNull().default("manual"),
    status: text("status", { enum: SIMULATOR_STATUSES }).notNull().default("draft"),
    authorReviewedAt: timestamptz("author_reviewed_at"),
    forkedFromId: uuid("forked_from_id").references((): AnyPgColumn => simulators.id, { onDelete: "set null" }),
    license: text("license").notNull().default("CC-BY-4.0"),
    publishedAt: timestamptz("published_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("simulators_slug_uidx").on(t.slug),
    index("simulators_status_kind_idx").on(t.status, t.kind),
    index("simulators_owner_id_idx").on(t.ownerId),
    check("simulators_slug_chk", sql`${t.slug} ~ '^[a-z0-9-]{3,60}$'`),
    check("simulators_kind_chk", sql`${t.kind} IN ('http', 'ussd')`),
    check("simulators_origin_chk", sql`${t.origin} IN ('manual', 'ai')`),
    check("simulators_status_chk", sql`${t.status} IN ('draft', 'to_verify', 'verified', 'unpublished')`),
    check("simulators_description_chk", sql`${t.description} IS NULL OR char_length(${t.description}) <= 1000`),
    check("simulators_not_self_fork_chk", sql`${t.forkedFromId} IS NULL OR ${t.forkedFromId} <> ${t.id}`),
  ],
);

/**
 * YAML figé par version. Une seule version courante par simulateur (index unique partiel).
 * Aucune version n'est modifiée après insertion ; aucun YAML invalide n'entre en base (validation serveur).
 */
export const simulatorVersions = pgTable(
  "simulator_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    simulatorId: uuid("simulator_id")
      .notNull()
      .references(() => simulators.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    yaml: text("yaml").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("simulator_versions_simulator_version_uidx").on(t.simulatorId, t.version),
    uniqueIndex("simulator_versions_one_current_uidx").on(t.simulatorId).where(sql`${t.isCurrent}`),
    check("simulator_versions_semver_chk", sql`${t.version} ~ '^[0-9]+\\.[0-9]+\\.[0-9]+$'`),
    check("simulator_versions_yaml_size_chk", sql`octet_length(${t.yaml}) <= 65536`),
  ],
);
