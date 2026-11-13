// Propriétaire : Dev B
// Connexion Valkey partagée de l'API (sessions de paiement, publication d'événements).
// Jamais de crash ni de requête bloquée si Valkey est injoignable : ioredis se reconnecte seul.
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { Redis } from "ioredis";

const ERROR_LOG_INTERVAL_MS = 30_000;
/** Délai maximal d'une commande courte passée par runCommand. */
export const COMMAND_TIMEOUT_MS = 1_000;

let url: string | undefined;
let logger: Pick<FastifyBaseLogger, "error"> = console;
let shared: Redis | null = null;

/**
 * À appeler au démarrage, avant tout usage de sharedValkey/runCommand. Connecte le client partagé
 * tout de suite (pas à la première commande) : sans ça, le tout premier appel reçu après le démarrage
 * du serveur peut tomber sur une connexion encore "connecting" et échouer en 503 pour rien.
 */
export function registerValkey(app: FastifyInstance, env: Record<string, string | undefined> = process.env): void {
  url = env.VALKEY_URL || undefined;
  logger = app.log;
  if (!url) {
    app.log.warn("VALKEY_URL absente : flux SSE et actions du téléphone désactivés");
  } else {
    sharedValkey();
  }
  app.addHook("onClose", async () => {
    shared?.disconnect();
    shared = null;
  });
}

/** Client partagé (créé au premier appel), ou null sans VALKEY_URL. */
export function sharedValkey(): Redis | null {
  if (!url) return null;
  if (!shared) {
    const client = new Redis(url, { maxRetriesPerRequest: null });
    let last = 0;
    client.on("error", (err: Error & { code?: string }) => {
      const now = Date.now();
      if (now - last < ERROR_LOG_INTERVAL_MS) return;
      last = now;
      logger.error({ code: err.code, reason: err.message }, "Valkey injoignable");
    });
    shared = client;
  }
  return shared;
}

/** Exécute une commande courte ; lève tout de suite si Valkey n'est pas prêt, ou après 1 s. */
export async function runCommand<T>(fn: (client: Redis) => Promise<T>): Promise<T> {
  const client = sharedValkey();
  if (!client) throw new Error("valkey_not_configured");
  if (client.status !== "ready") throw new Error(`valkey_not_ready (${client.status})`);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("valkey_timeout")), COMMAND_TIMEOUT_MS);
  });
  try {
    return await Promise.race([fn(client), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
