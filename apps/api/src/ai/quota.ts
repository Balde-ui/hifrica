// Propriétaire : Dev A
// Limites d'usage de l'assistant IA : 10 générations par heure et par client, plafond global par jour (UTC).
// Compteurs dans Valkey (INCR + EXPIRE) : un redémarrage ou un déploiement ne les remet pas à zéro.
// Si Valkey est injoignable, repli en mémoire (avertissement dans les logs, jamais de crash).
// TODO(C2) : quota par compte en base quand l'auth existe.
import { isIP } from "node:net";
import type { FastifyBaseLogger } from "fastify";
import { Redis } from "ioredis";

export const PER_CLIENT_LIMIT = 10;
export const PER_CLIENT_WINDOW_SEC = 3600;
export const DEFAULT_DAILY_LIMIT = 100;
const KEY_PREFIX = "hifrica:ai:quota";

type QuotaLogger = Pick<FastifyBaseLogger, "warn">;

// ---------------------------------------------------------------------------------------------------
// Clé de quota d'un client
// ---------------------------------------------------------------------------------------------------

/** Mots de 16 bits d'une IPv6 (gère "::" et l'IPv4 en fin d'adresse), ou null. */
function parseIPv6(input: string): number[] | null {
  let ip = input.split("%")[0].toLowerCase();
  const v4 = ip.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const b = v4.slice(1).map(Number);
    if (b.some((x) => x > 255)) return null;
    ip = ip.slice(0, -v4[0].length) + `${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const words = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (!words.every((w) => /^[0-9a-f]{1,4}$/.test(w))) return null;
  return words.map((w) => parseInt(w, 16));
}

/**
 * Clé de quota : l'IPv4 entière ; pour une IPv6, son préfixe /64 (un abonné reçoit en général tout un /64,
 * il pourrait sinon changer d'adresse à chaque requête) ; une IPv4 mappée (::ffff:a.b.c.d) redevient IPv4.
 */
export function clientKey(ip: string): string {
  const clean = ip.replace(/^\[|\]$/g, "");
  if (isIP(clean) === 4) return clean;
  if (isIP(clean.split("%")[0]) === 6) {
    const w = parseIPv6(clean);
    if (!w) return clean;
    if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) {
      return [w[6] >> 8, w[6] & 0xff, w[7] >> 8, w[7] & 0xff].join(".");
    }
    return `${w.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
  }
  return clean;
}

// ---------------------------------------------------------------------------------------------------
// Stockage des compteurs
// ---------------------------------------------------------------------------------------------------

export interface CounterStore {
  /** Incrémente `key` ; l'expiration (en s) n'est posée qu'à la création. Renvoie la valeur et le TTL restant. */
  incr(key: string, ttlSec: number): Promise<{ count: number; ttlSec: number }>;
  close(): Promise<void>;
}

/** Compteurs en mémoire (fenêtre fixe à partir du premier appel). */
export class MemoryStore implements CounterStore {
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async incr(key: string, ttlSec: number): Promise<{ count: number; ttlSec: number }> {
    const now = this.now();
    if (this.counters.size > 10_000) {
      for (const [k, v] of this.counters) if (v.expiresAt <= now) this.counters.delete(k);
    }
    let entry = this.counters.get(key);
    if (!entry || entry.expiresAt <= now) {
      entry = { count: 0, expiresAt: now + ttlSec * 1000 };
      this.counters.set(key, entry);
    }
    entry.count++;
    return { count: entry.count, ttlSec: Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)) };
  }

  async close(): Promise<void> {}
}

/** Compteurs Valkey : MULTI INCR + EXPIRE NX + TTL (atomique, partagé entre redémarrages et instances). */
export class ValkeyStore implements CounterStore {
  private readonly client: Redis;

  constructor(url: string, log: QuotaLogger) {
    // Échec rapide : pas de file hors ligne, délai court. L'appelant se replie alors en mémoire.
    this.client = new Redis(url, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      commandTimeout: 1_000,
    });
    let lastLog = 0;
    this.client.on("error", (err: Error & { code?: string }) => {
      if (Date.now() - lastLog < 30_000) return;
      lastLog = Date.now();
      log.warn({ code: err.code, reason: err.message }, "Valkey injoignable (quotas de l'assistant IA)");
    });
  }

  /**
   * Pendant la connexion initiale (juste après un démarrage), on attend Valkey au plus 1 s : sinon les
   * premières requêtes partiraient en mémoire et contourneraient les compteurs existants. Si Valkey est
   * en panne (reconnexion), on échoue tout de suite et l'appelant se replie en mémoire.
   */
  private async ready(): Promise<void> {
    const status = this.client.status;
    if (status === "ready") return;
    if (status !== "wait" && status !== "connecting" && status !== "connect") throw new Error(`valkey_${status}`);
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.client.off("ready", onReady);
        this.client.off("error", onError);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      // Première erreur de connexion (Valkey arrêté) : inutile d'attendre la seconde complète.
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("valkey_connect_timeout"));
      }, 1_000);
      this.client.once("ready", onReady);
      this.client.once("error", onError);
    });
  }

  async incr(key: string, ttlSec: number): Promise<{ count: number; ttlSec: number }> {
    await this.ready();
    const results = await this.client.multi().incr(key).expire(key, ttlSec, "NX").ttl(key).exec();
    if (!results || results.some(([err]) => err)) throw new Error("valkey_multi_failed");
    const count = Number(results[0][1]);
    const ttl = Number(results[2][1]);
    return { count, ttlSec: ttl > 0 ? ttl : ttlSec };
  }

  async close(): Promise<void> {
    this.client.disconnect();
  }
}

/** Valkey d'abord ; en cas d'erreur, la mémoire (avertissement au plus toutes les 30 s). */
export class FallbackStore implements CounterStore {
  private lastWarn = 0;

  constructor(
    private readonly primary: CounterStore,
    private readonly fallback: CounterStore,
    private readonly log: QuotaLogger,
  ) {}

  async incr(key: string, ttlSec: number): Promise<{ count: number; ttlSec: number }> {
    try {
      return await this.primary.incr(key, ttlSec);
    } catch (err) {
      if (Date.now() - this.lastWarn >= 30_000) {
        this.lastWarn = Date.now();
        this.log.warn({ reason: err instanceof Error ? err.message : "error" }, "quotas de l'assistant IA : repli en mémoire");
      }
      return this.fallback.incr(key, ttlSec);
    }
  }

  async close(): Promise<void> {
    await Promise.all([this.primary.close(), this.fallback.close()]);
  }
}

// ---------------------------------------------------------------------------------------------------
// Quotas
// ---------------------------------------------------------------------------------------------------

export type QuotaResult =
  | { ok: true }
  | { ok: false; error: "quota_exceeded" | "daily_limit_reached"; retryAfter: number };

export interface AiQuotaOptions {
  store: CounterStore;
  perClientLimit?: number;
  windowSec?: number;
  dailyLimit?: number;
  now?: () => number;
}

export class AiQuota {
  readonly perClientLimit: number;
  readonly windowSec: number;
  readonly dailyLimit: number;
  private readonly store: CounterStore;
  private readonly now: () => number;

  constructor(opts: AiQuotaOptions) {
    this.store = opts.store;
    this.perClientLimit = opts.perClientLimit ?? PER_CLIENT_LIMIT;
    this.windowSec = opts.windowSec ?? PER_CLIENT_WINDOW_SEC;
    this.dailyLimit = opts.dailyLimit ?? DEFAULT_DAILY_LIMIT;
    this.now = opts.now ?? Date.now;
  }

  /** Consomme une génération : quota du client d'abord, puis plafond global du jour (UTC). */
  async consume(ip: string): Promise<QuotaResult> {
    const client = await this.store.incr(`${KEY_PREFIX}:client:${clientKey(ip)}`, this.windowSec);
    if (client.count > this.perClientLimit) return { ok: false, error: "quota_exceeded", retryAfter: client.ttlSec };

    const now = new Date(this.now());
    const day = now.toISOString().slice(0, 10);
    const untilMidnight = Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000);
    // La clé du jour expire un peu après minuit UTC (marge de 1 h), son nom changeant de toute façon.
    const daily = await this.store.incr(`${KEY_PREFIX}:daily:${day}`, untilMidnight + 3600);
    if (daily.count > this.dailyLimit) return { ok: false, error: "daily_limit_reached", retryAfter: Math.max(1, untilMidnight) };
    return { ok: true };
  }

  close(): Promise<void> {
    return this.store.close();
  }
}

/** Quotas à partir de l'environnement : Valkey si VALKEY_URL (avec repli mémoire), sinon mémoire seule. */
export function createQuotaFromEnv(env: Record<string, string | undefined>, log: QuotaLogger): AiQuota {
  const parsed = Number(env.AI_DAILY_LIMIT);
  const dailyLimit = env.AI_DAILY_LIMIT && Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_DAILY_LIMIT;
  const memory = new MemoryStore();
  if (!env.VALKEY_URL) {
    log.warn("VALKEY_URL absente : quotas de l'assistant IA en mémoire (remis à zéro au redémarrage)");
    return new AiQuota({ store: memory, dailyLimit });
  }
  return new AiQuota({ store: new FallbackStore(new ValkeyStore(env.VALKEY_URL, log), memory, log), dailyLimit });
}
