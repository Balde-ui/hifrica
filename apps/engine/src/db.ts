// Propriétaire : Dev C (C3 / C4)
// Connexion du moteur à la base (clés de test, scénario actif, journaux). Les migrations sont
// appliquées par l'API : le moteur ne fait que lire et insérer.
import { createDb, createPool, type Database } from "@hifrica/db";

let db: Database | null | undefined;

/** Base du moteur, ou null sans DATABASE_URL (développement local sans base). */
export function getDb(): Database | null {
  if (db !== undefined) return db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    db = null;
    return db;
  }
  const pool = createPool(url, { max: 10, applicationName: "hifrica-engine" });
  // Une connexion inactive coupée (redémarrage de PostgreSQL) ne doit pas arrêter le moteur.
  pool.on("error", (err: Error & { code?: string }) => console.warn(JSON.stringify({ msg: "connexion PostgreSQL perdue", code: err.code })));
  db = createDb(pool);
  return db;
}
