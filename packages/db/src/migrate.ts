// Application des migrations au démarrage, sur UNE connexion dédiée (pg.Client, pas un Pool).
// Pourquoi : avec un Pool, drizzle lit l'état des migrations sur une connexion quelconque puis ouvre la
// transaction sur une autre (pool.connect()). Un verrou consultatif pris via le Pool ne protégerait pas
// la connexion qui migre, et son déverrouillage pourrait partir sur une troisième connexion.
// Ici, verrou, lecture, transaction et déverrouillage passent tous par le même client.
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/** Dossier des migrations SQL versionnées, livré avec le paquet. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

/** Clé du verrou consultatif réservée aux migrations Hifrica. */
export const MIGRATION_LOCK_KEY = "7206394851002";

export interface RunMigrationsOptions {
  databaseUrl: string;
  migrationsFolder?: string;
  log?: (message: string) => void;
  /** Tentatives de connexion (Postgres peut démarrer après l'API). Défaut : 15. */
  connectAttempts?: number;
  connectRetryDelayMs?: number;
  /** Attente maximale du verrou tenu par un autre processus. Défaut : 120 s. */
  lockTimeoutMs?: number;
  lockPollMs?: number;
}

async function connectWithRetry(options: RunMigrationsOptions, log: (m: string) => void): Promise<pg.Client> {
  const attempts = options.connectAttempts ?? 15;
  const delay = options.connectRetryDelayMs ?? 2000;
  for (let attempt = 1; ; attempt++) {
    // Un client dont la connexion a échoué ne peut pas être réutilisé : on en crée un neuf à chaque essai.
    const client = new pg.Client({
      connectionString: options.databaseUrl,
      application_name: "hifrica-migrate",
      options: "-c timezone=UTC",
    });
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      if (attempt >= attempts) throw error;
      log(`Base injoignable (tentative ${attempt}/${attempts}) : nouvel essai dans ${delay} ms.`);
      await sleep(delay);
    }
  }
}

async function acquireLock(client: pg.Client, options: RunMigrationsOptions, log: (m: string) => void) {
  const timeout = options.lockTimeoutMs ?? 120_000;
  const poll = options.lockPollMs ?? 500;
  const deadline = Date.now() + timeout;
  let waiting = false;
  // pg_try_advisory_lock plutôt que pg_advisory_lock : on ne veut pas attendre indéfiniment.
  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1::bigint) AS locked", [
      MIGRATION_LOCK_KEY,
    ]);
    if (rows[0]?.locked) return;
    if (Date.now() >= deadline) {
      throw new Error(`Verrou de migration non obtenu après ${timeout} ms (un autre processus migre-t-il ?).`);
    }
    if (!waiting) {
      log("Migrations en cours dans un autre processus : attente du verrou.");
      waiting = true;
    }
    await sleep(poll);
  }
}

export async function runMigrations(options: RunMigrationsOptions): Promise<void> {
  const log = options.log ?? (() => {});
  const client = await connectWithRetry(options, log);
  try {
    // Borne l'attente des verrous de table pris par les DDL.
    await client.query("SET lock_timeout TO '15s'");
    await acquireLock(client, options, log);
    try {
      // drizzle(client) avec un pg.Client : lectures ET transaction de migration sur ce même client.
      await migrate(drizzle(client), { migrationsFolder: options.migrationsFolder ?? MIGRATIONS_FOLDER });
      log("Migrations de la base à jour.");
    } finally {
      await client.query("SELECT pg_advisory_unlock($1::bigint)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    // Fermer la connexion libère aussi tout verrou de session qui resterait.
    await client.end();
  }
}
