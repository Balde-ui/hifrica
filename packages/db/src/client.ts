import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema>;

/**
 * Pool de l'application. Toutes les sessions sont en UTC : les colonnes `timestamp` sans fuseau
 * générées par Better Auth et leurs valeurs par défaut (now()) restent ainsi cohérentes.
 * À créer APRÈS runMigrations().
 */
export function createPool(databaseUrl: string, options: { max?: number; applicationName?: string } = {}): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 10,
    application_name: options.applicationName ?? "hifrica",
    options: "-c timezone=UTC",
  });
}

export function createDb(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}
