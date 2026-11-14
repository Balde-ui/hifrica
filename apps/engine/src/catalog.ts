// Propriétaire : Dev A
// Résolution d'un simulateur par son slug, partout où le moteur en cherche un (route HTTP, route USSD,
// confirmations A4, redirection navigateur) :
//   1. les fichiers de simulators/ (prioritaires, inchangés) ;
//   2. sinon un simulateur publié depuis l'éditeur (packages/db, getExecutableSimulator), revalidé avec le
//      même schéma que les fichiers : un YAML invalide n'est jamais exécuté.
// Cache par slug : 30 s si trouvé, 10 s si absent, 500 entrées au plus (les plus anciennes sortent).
// Base injoignable ou muette plus de 3 s → EngineUnavailableError (les routes répondent 503
// engine_unavailable, pas 404).
// Sans base (développement local) : les fichiers seulement, comme avant.
import { getExecutableSimulator, isDbOperationError, isSlug, type Database, type ExecutableSimulator } from "@hifrica/db";
import { validateSimulatorYaml } from "@hifrica/shared";
import type { FastifyBaseLogger } from "fastify";
import { getDb } from "./db.js";
import type { Simulator } from "./simulators.js";

export const FOUND_TTL_MS = 30_000;
export const MISSING_TTL_MS = 10_000;
export const MAX_CACHE_ENTRIES = 500;
/** Une base figée (sans erreur de connexion) ne doit pas bloquer la requête : au-delà, 503. */
export const DB_TIMEOUT_MS = 3_000;

/** La base ne répond pas : le simulateur existe peut-être, on ne peut pas le dire. */
export class EngineUnavailableError extends Error {
  override readonly name = "EngineUnavailableError";
  constructor(readonly reason: string) {
    super(`simulateurs publiés indisponibles (${reason})`);
  }
}

export function isEngineUnavailable(err: unknown): err is EngineUnavailableError {
  return err instanceof EngineUnavailableError;
}

export type SimulatorResolver = (slug: string) => Promise<Simulator | null>;
/** Ce qu'acceptent les modules qui cherchent un simulateur : une Map (tests, fichiers seuls) ou un résolveur. */
export type SimulatorSource = Map<string, Simulator> | SimulatorResolver;

export function toResolver(source: SimulatorSource): SimulatorResolver {
  if (typeof source === "function") return source;
  return async (slug) => source.get(slug) ?? null;
}

type CatalogLogger = Pick<FastifyBaseLogger, "error" | "warn">;

export interface CatalogOptions {
  /** Simulateurs du dossier simulators/ : prioritaires sur un simulateur publié du même slug. */
  files: Map<string, Simulator>;
  log: CatalogLogger;
  /** Base du moteur (par défaut getDb() : null sans DATABASE_URL). */
  getDb?: () => Database | null;
  /** Lecture en base (par défaut getExecutableSimulator) ; remplaçable dans les tests. */
  fetchPublished?: (db: Database, slug: string) => Promise<ExecutableSimulator | null>;
  now?: () => number;
  dbTimeoutMs?: number;
  foundTtlMs?: number;
  missingTtlMs?: number;
  maxEntries?: number;
}

export interface Catalog {
  resolve: SimulatorResolver;
  /** Nombre d'entrées en cache (tests, diagnostic). */
  readonly size: number;
}

export function createCatalog(opts: CatalogOptions): Catalog {
  const { files, log } = opts;
  const dbOf = opts.getDb ?? getDb;
  const fetchPublished = opts.fetchPublished ?? getExecutableSimulator;
  const now = opts.now ?? Date.now;
  const dbTimeout = opts.dbTimeoutMs ?? DB_TIMEOUT_MS;
  const foundTtl = opts.foundTtlMs ?? FOUND_TTL_MS;
  const missingTtl = opts.missingTtlMs ?? MISSING_TTL_MS;
  const maxEntries = opts.maxEntries ?? MAX_CACHE_ENTRIES;

  const cache = new Map<string, { sim: Simulator | null; expiresAt: number }>();
  const pending = new Map<string, Promise<Simulator | null>>();

  function remember(slug: string, sim: Simulator | null): void {
    cache.delete(slug); // réinsertion en fin : l'ordre de la Map est l'ordre d'ancienneté
    cache.set(slug, { sim, expiresAt: now() + (sim ? foundTtl : missingTtl) });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value as string);
  }

  /** Lit, valide et construit le simulateur publié ; null s'il n'existe pas ou si son YAML est invalide. */
  async function load(db: Database, slug: string): Promise<Simulator | null> {
    let row: ExecutableSimulator | null;
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new EngineUnavailableError("timeout")), dbTimeout);
      });
      row = await Promise.race([fetchPublished(db, slug), timeout]);
    } catch (err) {
      // Toute erreur de base (DbOperationError, déjà sans donnée sensible) : indisponible, jamais « inconnu ».
      const reason = isEngineUnavailable(err) ? err.reason : isDbOperationError(err) ? err.kind : "error";
      log.error({ slug, reason }, "simulateur publié : lecture en base impossible");
      throw new EngineUnavailableError(reason);
    } finally {
      clearTimeout(timer);
    }
    if (!row) return null;
    const result = validateSimulatorYaml(row.yaml);
    const sim = result.valid ? (result.simulator as Simulator) : null;
    if (!sim || sim.name !== row.slug) {
      // Jamais le YAML ni les erreurs détaillées dans les logs : seulement des identifiants.
      log.error({ slug, version: row.version, errors: result.valid ? 0 : result.errors.length }, "simulateur publié invalide : non exécuté");
      return null;
    }
    return sim;
  }

  async function resolve(slug: string): Promise<Simulator | null> {
    const file = files.get(slug);
    if (file) return file;
    const db = dbOf();
    if (!db || !isSlug(slug)) return null;

    const hit = cache.get(slug);
    if (hit && hit.expiresAt > now()) return hit.sim;

    // Une seule lecture en base pour des appels simultanés au même slug.
    const inflight = pending.get(slug);
    if (inflight) return inflight;
    const promise = load(db, slug)
      .then((sim) => {
        remember(slug, sim);
        return sim;
      })
      .finally(() => pending.delete(slug));
    pending.set(slug, promise);
    return promise;
  }

  return {
    resolve,
    get size() {
      return cache.size;
    },
  };
}
