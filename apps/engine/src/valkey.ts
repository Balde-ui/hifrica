// Propriétaire : Dev A
// Connexions Valkey du moteur (VALKEY_URL).
//   - un client PARTAGÉ pour les commandes courtes : file BullMQ (producteur), sessions de paiement,
//     dédoublonnage des confirmations ;
//   - des clients DÉDIÉS seulement là où c'est obligatoire : le Worker BullMQ (commandes bloquantes) et
//     l'abonnement PSUBSCRIBE (une connexion abonnée ne peut plus envoyer d'autres commandes).
// Valkey injoignable : jamais de crash ni de requête bloquée ; ioredis se reconnecte seul.
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { Redis, type RedisOptions } from "ioredis";

type ValkeyLogger = Pick<FastifyBaseLogger, "error" | "warn">;

const ERROR_LOG_INTERVAL_MS = 30_000;
/** Délai maximal d'une commande courte passée par runCommand. */
export const COMMAND_TIMEOUT_MS = 1_000;

let url: string | undefined;
let logger: ValkeyLogger = console;
let shared: Redis | null = null;
const opened: Redis[] = [];

/** Un seul log d'erreur de connexion toutes les 30 s (ioredis se reconnecte en boucle quand Valkey est arrêté). */
function attachErrorLog(client: Redis, source: string): void {
  let last = 0;
  client.on("error", (err: Error & { code?: string }) => {
    const now = Date.now();
    if (now - last < ERROR_LOG_INTERVAL_MS) return;
    last = now;
    logger.error({ source, code: err.code, reason: err.message }, "Valkey injoignable");
  });
}

function open(source: string, options: RedisOptions): Redis {
  if (!url) throw new Error("VALKEY_URL absente");
  const client = new Redis(url, options);
  attachErrorLog(client, source);
  opened.push(client);
  return client;
}

/**
 * Prépare les connexions (sans rien ouvrir tant qu'on ne les demande pas) et les ferme à l'arrêt de Fastify.
 * À appeler AVANT les modules qui les utilisent : les crochets onClose s'exécutent du dernier au premier
 * enregistré, donc les connexions sont fermées après le Worker, la file et l'abonnement.
 */
export function registerValkey(app: FastifyInstance, env: Record<string, string | undefined> = process.env): void {
  url = env.VALKEY_URL || undefined;
  logger = app.log;
  if (!url) app.log.warn("VALKEY_URL absente : file de webhooks, sessions de paiement et confirmations désactivées");
  app.addHook("onClose", async () => closeValkey());
}

export function valkeyConfigured(): boolean {
  return url !== undefined;
}

/**
 * Client partagé (créé au premier appel), ou null sans VALKEY_URL. File hors ligne active et
 * maxRetriesPerRequest: null : l'initialisation de BullMQ attend Valkey au lieu d'échouer pour de bon.
 * Les appels courts doivent passer par runCommand, qui refuse d'attendre si Valkey n'est pas prêt.
 */
export function sharedValkey(): Redis | null {
  if (!url) return null;
  shared ??= open("shared", { maxRetriesPerRequest: null });
  return shared;
}

/** Connexion dédiée (Worker BullMQ, PSUBSCRIBE), avec reconnexion automatique et erreurs loguées. */
export function dedicatedValkey(source: string, options: RedisOptions = { maxRetriesPerRequest: null }): Redis | null {
  if (!url) return null;
  return open(source, options);
}

/** Exécute une commande courte sur le client partagé ; lève tout de suite si Valkey n'est pas prêt, ou après 1 s. */
export async function runCommand<T>(fn: (client: Redis) => Promise<T>, client: Redis | null = sharedValkey()): Promise<T> {
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

/** Ferme toutes les connexions ouvertes (appelé par onClose). */
export async function closeValkey(): Promise<void> {
  for (const client of opened.splice(0)) client.disconnect();
  shared = null;
}
