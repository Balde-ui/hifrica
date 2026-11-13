// Propriétaire : Dev C (C6) — réception des webhooks par la boutique de démonstration Awa.
//
// POST /api/demo/webhooks/:projectId : route PUBLIQUE appelée par le moteur (A5). Elle joue le rôle du
// serveur du marchand : vérifie la signature HMAC du webhook avec le secret DU projet de l'URL, puis garde
// la confirmation de paiement (24 h, 20 au plus par projet) dans Valkey.
// GET /api/projects/:id/demo/webhooks : session + propriété du projet ; confirmations déjà vérifiées.
//
// Règles :
// - signature vérifiée sur les octets EXACTS reçus (parseur propre à ce plugin, jamais JSON.stringify) ;
// - décisions lues uniquement dans le corps signé (event, id, data.id, data.status) : les en-têtes
//   X-Hifrica-Event / -Delivery / -Request-Id ne sont pas signés ;
// - le secret, l'identifiant de clé et les détails de déchiffrement ne sortent jamais (ni réponse, ni log) ;
// - déduplication par identifiant d'envoi ET par paiement (script Lua, marqueurs écrits en dernier),
//   doublée à la lecture ; visibilité de 24 h par confirmation, appliquée à la lecture ;
// - Valkey indisponible : 503, pour que le moteur relance.
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  decryptWebhookSecret,
  isDbOperationError,
  isUuid,
  projects,
  safeDbCall,
  type Database,
  type WebhookSecretKeyring,
} from "@hifrica/db";
import { verifyWebhookSignature } from "@hifrica/shared/webhook-signature";
import type { Redis } from "ioredis";
import { assertProjectOwner, requireUser, type AuthenticatedUser } from "./auth.js";
import { runCommand } from "./valkey.js";

/** Nombre de confirmations gardées par projet. */
export const DEMO_CONFIRMATIONS_LIMIT = 20;
/**
 * Durée de visibilité d'une confirmation et durée de vie des marqueurs de déduplication (24 h).
 * La visibilité est appliquée à la lecture, entrée par entrée, d'après receivedAt (voir visibleConfirmations).
 */
export const DEMO_TTL_SEC = 86_400;
/** Taille maximale du corps reçu. */
export const DEMO_BODY_LIMIT = 64 * 1024;
/** Tolérance d'horodatage de la signature (contrat A5 / @hifrica/shared/webhook-signature). */
export const SIGNATURE_TOLERANCE_SEC = 300;
/** Seul événement pris en charge par la boutique : la confirmation d'un paiement. */
export const DEMO_EVENT = "checkout.completed";

/** Confirmation vérifiée, telle que la boutique la lit. Jamais de secret ni de corps brut. */
export interface DemoConfirmation {
  /** Identifiant du checkout (data.id du corps signé) = id renvoyé à la boutique dans la réponse 201. */
  paymentId: string;
  event: typeof DEMO_EVENT;
  status: "succeeded";
  amount: number | string;
  currency: string | null;
  /** X-Hifrica-Request-Id (non signé) : traçabilité seulement, null s'il n'est pas un UUID. */
  requestId: string | null;
  /** Identifiant d'envoi (id du corps signé). */
  deliveryId: string;
  receivedAt: string;
}

export type SecretLookup = { status: "ok"; secret: string } | { status: "not_found" } | { status: "unavailable" };

/** Stockage des confirmations (Valkey en production, remplaçable dans les tests). */
export interface DemoConfirmationStore {
  /** Ajout atomique. false si l'envoi ou le paiement a déjà été reçu. Lève si le stockage est indisponible. */
  add(projectId: string, entry: DemoConfirmation): Promise<boolean>;
  /** Confirmations les plus récentes d'abord. Lève si le stockage est indisponible. */
  list(projectId: string, limit: number): Promise<DemoConfirmation[]>;
}

export interface DemoWebhooksOptions {
  db?: Database;
  keyring?: WebhookSecretKeyring | null;
  /** Secret déchiffré du projet (remplaçable dans les tests). */
  loadSecret?: (projectId: string) => Promise<SecretLookup>;
  store?: DemoConfirmationStore;
  requireUser?: (req: FastifyRequest) => Promise<AuthenticatedUser | null>;
  assertProjectOwner?: (user: AuthenticatedUser, projectId: string) => Promise<boolean>;
  /** Horloge en secondes (tests de l'expiration de la signature). */
  nowSec?: () => number;
}

// ---------------------------------------------------------------------------------------------------
// Secret du projet
// ---------------------------------------------------------------------------------------------------

/**
 * Lit le secret chiffré d'un projet (fetchEncrypted) puis le déchiffre avec le keyring.
 * Toute erreur de déchiffrement devient « unavailable », sans message : WebhookSecretError peut nommer
 * l'identifiant de clé, qui ne doit apparaître ni dans une réponse ni dans un journal.
 */
export function createSecretLoader(
  fetchEncrypted: (projectId: string) => Promise<string | null>,
  keyring: WebhookSecretKeyring | null | undefined,
): (projectId: string) => Promise<SecretLookup> {
  return async (projectId) => {
    if (!keyring) return { status: "unavailable" };
    const encrypted = await fetchEncrypted(projectId);
    if (encrypted === null) return { status: "not_found" };
    try {
      return { status: "ok", secret: decryptWebhookSecret(encrypted, projectId, keyring) };
    } catch {
      return { status: "unavailable" };
    }
  };
}

function fetchEncryptedFromDb(db: Database) {
  return async (projectId: string): Promise<string | null> => {
    const [row] = await safeDbCall("get_project", () =>
      db.select({ enc: projects.webhookSecretEnc }).from(projects).where(eq(projects.id, projectId)).limit(1),
    );
    return row?.enc ?? null;
  };
}

// ---------------------------------------------------------------------------------------------------
// Stockage Valkey : script Lua atomique
// ---------------------------------------------------------------------------------------------------

/**
 * KEYS[1] = marqueur « paiement déjà confirmé », KEYS[2] = marqueur « envoi déjà reçu », KEYS[3] = liste.
 * ARGV[1] = confirmation (JSON), ARGV[2] = durée de vie en secondes, ARGV[3] = dernier index gardé (19).
 * Retourne 1 si la confirmation est ajoutée, 0 si l'envoi ou le paiement était déjà connu.
 *
 * Valkey exécute le script sans interruption par d'autres clients, mais N'ANNULE PAS les écritures déjà
 * faites si une commande échoue ensuite (pas de rollback). L'ordre est donc choisi pour que le pire cas
 * soit un doublon (masqué à la lecture), jamais une perte :
 *   1. déjà reçu ? → 0, aucune écriture ;
 *   2. type de la liste vérifié AVANT toute écriture (sinon erreur, aucune écriture) ;
 *   3. confirmation écrite d'abord (LPUSH, LTRIM 20, EXPIRE de nettoyage) ;
 *   4. marqueurs écrits en DERNIER : s'il échoue avant, aucun marqueur n'existe sans sa confirmation ;
 *      la relance du moteur (réponse 503) rajoute alors la confirmation, en double au pire.
 * L'EXPIRE de la liste ne sert qu'à nettoyer un projet inactif : la règle des 24 h par confirmation est
 * appliquée à la lecture (receivedAt), pas par cette expiration, qui se prolonge à chaque ajout.
 */
export const DEDUP_AND_STORE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
local listType = redis.call('TYPE', KEYS[3])['ok']
if listType ~= 'none' and listType ~= 'list' then
  return redis.error_reply('demo_list_wrong_type')
end
redis.call('LPUSH', KEYS[3], ARGV[1])
redis.call('LTRIM', KEYS[3], 0, ARGV[3])
redis.call('EXPIRE', KEYS[3], ARGV[2])
redis.call('SET', KEYS[2], '1', 'EX', ARGV[2])
redis.call('SET', KEYS[1], '1', 'EX', ARGV[2])
return 1
`;

export function demoKeys(projectId: string, paymentId: string, deliveryId: string) {
  return {
    payment: `demo-webhook:paid:${projectId}:${paymentId}`,
    delivery: `demo-webhook:delivery:${projectId}:${deliveryId}`,
    list: demoListKey(projectId),
  };
}

export function demoListKey(projectId: string): string {
  return `demo-webhooks:${projectId}`;
}

type Runner = <T>(fn: (client: Redis) => Promise<T>) => Promise<T>;

/** Stockage sur le client Valkey partagé de l'API (runCommand : échec immédiat si Valkey n'est pas prêt, 1 s au plus). */
export function createValkeyDemoStore(run: Runner = runCommand): DemoConfirmationStore {
  return {
    async add(projectId, entry) {
      const keys = demoKeys(projectId, entry.paymentId, entry.deliveryId);
      const added = await run((c) =>
        c.eval(
          DEDUP_AND_STORE_SCRIPT,
          3,
          keys.payment,
          keys.delivery,
          keys.list,
          JSON.stringify(entry),
          String(DEMO_TTL_SEC),
          String(DEMO_CONFIRMATIONS_LIMIT - 1),
        ),
      );
      return Number(added) === 1;
    },
    async list(projectId, limit) {
      const raw = await run((c) => c.lrange(demoListKey(projectId), 0, Math.max(0, limit - 1)));
      return raw.map(parseStoredConfirmation).filter((e): e is DemoConfirmation => e !== null);
    },
  };
}

/** Relit une entrée stockée ; une entrée illisible est ignorée (jamais renvoyée telle quelle). */
export function parseStoredConfirmation(raw: string): DemoConfirmation | null {
  try {
    const e = JSON.parse(raw) as Partial<DemoConfirmation>;
    if (typeof e.paymentId !== "string" || typeof e.deliveryId !== "string" || typeof e.receivedAt !== "string") return null;
    return {
      paymentId: e.paymentId,
      event: DEMO_EVENT,
      status: "succeeded",
      amount: typeof e.amount === "number" || typeof e.amount === "string" ? e.amount : "",
      currency: typeof e.currency === "string" ? e.currency : null,
      requestId: typeof e.requestId === "string" && isUuid(e.requestId) ? e.requestId : null,
      deliveryId: e.deliveryId,
      receivedAt: e.receivedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Confirmations visibles par la boutique : reçues depuis moins de 24 h (strictement), sans doublon (même
 * paiement ou même envoi : seule la plus récente est gardée), 20 au plus, les plus récentes d'abord.
 * Le dédoublonnage couvre le seul état incohérent possible du script (confirmation écrite deux fois).
 */
export function visibleConfirmations(entries: DemoConfirmation[], nowSec: number, limit = DEMO_CONFIRMATIONS_LIMIT): DemoConfirmation[] {
  const oldestMs = (nowSec - DEMO_TTL_SEC) * 1000;
  const payments = new Set<string>();
  const deliveries = new Set<string>();
  const out: DemoConfirmation[] = [];
  for (const entry of entries) {
    const receivedMs = Date.parse(entry.receivedAt);
    if (!Number.isFinite(receivedMs) || receivedMs <= oldestMs) continue;
    if (payments.has(entry.paymentId) || deliveries.has(entry.deliveryId)) continue;
    payments.add(entry.paymentId);
    deliveries.add(entry.deliveryId);
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Validation du corps signé
// ---------------------------------------------------------------------------------------------------

/** Forme minimale de X-Hifrica-Signature avant toute requête SQL : un t et au moins un v1 hexadécimal. */
const SIGNATURE_T = /(?:^|,)\s*t=\d{1,12}\s*(?:,|$)/;
const SIGNATURE_V1 = /(?:^|,)\s*v1=[0-9a-fA-F]{64}\s*(?:,|$)/;
const PAYMENT_ID = /^[\x21-\x7e]{1,128}$/;
const AMOUNT_TEXT = /^\d{1,15}(\.\d{1,6})?$/;
const CURRENCY = /^[A-Za-z]{1,8}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Parsed =
  | { kind: "confirmation"; deliveryId: string; paymentId: string; amount: number | string; currency: string | null }
  | { kind: "ignored" }
  | { kind: "invalid" };

/** Lit le corps déjà authentifié. Toutes les décisions viennent d'ici, jamais des en-têtes. */
export function parseSignedBody(rawBody: string): Parsed {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { kind: "invalid" };
  }
  if (!isRecord(body) || typeof body.event !== "string") return { kind: "invalid" };
  // Événement authentique mais non pris en charge : accepté (2xx) pour que le moteur ne relance pas.
  if (body.event !== DEMO_EVENT) return { kind: "ignored" };
  const data = body.data;
  if (typeof body.id !== "string" || !isUuid(body.id) || !isRecord(data)) return { kind: "invalid" };
  if (typeof data.id !== "string" || !PAYMENT_ID.test(data.id) || typeof data.status !== "string") return { kind: "invalid" };
  if (data.status !== "succeeded") return { kind: "ignored" };
  const amount = data.amount;
  const amountOk = (typeof amount === "number" && Number.isFinite(amount) && amount >= 0) || (typeof amount === "string" && AMOUNT_TEXT.test(amount));
  if (!amountOk) return { kind: "invalid" };
  if (data.currency !== undefined && (typeof data.currency !== "string" || !CURRENCY.test(data.currency))) return { kind: "invalid" };
  return {
    kind: "confirmation",
    deliveryId: body.id,
    paymentId: data.id,
    amount: amount as number | string,
    currency: typeof data.currency === "string" ? data.currency : null,
  };
}

// ---------------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------------

function fail(reply: FastifyReply, status: number, error: string, message?: string) {
  return reply.code(status).send(message ? { error, message } : { error });
}

export function registerDemoWebhooks(app: FastifyInstance, opts: DemoWebhooksOptions): void {
  const loadSecret =
    opts.loadSecret ?? (opts.db ? createSecretLoader(fetchEncryptedFromDb(opts.db), opts.keyring) : null);
  if (!loadSecret) throw new Error("registerDemoWebhooks : db ou loadSecret requis");
  const store = opts.store ?? createValkeyDemoStore();
  const getUser = opts.requireUser ?? requireUser;
  const isOwner = opts.assertProjectOwner ?? assertProjectOwner;
  const nowSec = opts.nowSec ?? (() => Math.floor(Date.now() / 1000));

  // Plugin encapsulé : son parseur JSON (corps brut) et son gestionnaire d'erreurs ne valent que pour ses
  // routes. Le parseur global et le gestionnaire de platform.ts (qui changerait un 413 en 500, donc en
  // relance inutile du moteur) ne sont pas touchés.
  void app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: DEMO_BODY_LIMIT }, (_req, body, done) => {
      done(null, body);
    });

    scope.setErrorHandler((err, req, reply) => {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 413) return fail(reply, 413, "body_too_large", "Corps trop volumineux (64 Ko).");
      if (status === 415) return fail(reply, 415, "unsupported_media_type", "Content-Type attendu : application/json.");
      if (status === 400) return fail(reply, 400, "invalid_body", "Requête mal formée.");
      if (isDbOperationError(err)) {
        req.log.error({ operation: err.operation, kind: err.kind }, "récepteur de démo : base indisponible");
        return fail(reply, 503, "unavailable", "Service momentanément indisponible, réessayez.");
      }
      req.log.error({ code: (err as { code?: string }).code }, "récepteur de démo : erreur inattendue");
      return fail(reply, 500, "internal_error", "Erreur interne.");
    });

    scope.post<{ Params: { projectId: string } }>("/api/demo/webhooks/:projectId", async (req, reply) => {
      const { projectId } = req.params;
      // Contrôles sans accès à la base, du moins coûteux au plus coûteux.
      if (!isUuid(projectId)) return fail(reply, 404, "not_found");
      const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (contentType !== "application/json") {
        return fail(reply, 415, "unsupported_media_type", "Content-Type attendu : application/json.");
      }
      const header = req.headers["x-hifrica-signature"];
      if (typeof header !== "string" || !SIGNATURE_T.test(header) || !SIGNATURE_V1.test(header)) {
        return fail(reply, 401, "invalid_signature");
      }
      const rawBody = req.body;
      if (typeof rawBody !== "string" || rawBody.length === 0) return fail(reply, 400, "invalid_body");

      const lookup = await loadSecret(projectId);
      if (lookup.status === "not_found") return fail(reply, 404, "not_found");
      if (lookup.status === "unavailable") {
        req.log.error({ projectId, reason: "webhook_secret_unavailable" }, "récepteur de démo : secret du projet indisponible");
        return fail(reply, 503, "unavailable", "Service momentanément indisponible, réessayez.");
      }
      // Le secret ne quitte pas cette expression : ni journal, ni réponse.
      if (!verifyWebhookSignature(lookup.secret, header, rawBody, SIGNATURE_TOLERANCE_SEC, nowSec())) {
        req.log.warn({ projectId, reason: "invalid_signature" }, "récepteur de démo : signature refusée");
        return fail(reply, 401, "invalid_signature");
      }

      const parsed = parseSignedBody(rawBody);
      if (parsed.kind === "invalid") return fail(reply, 400, "invalid_body");
      if (parsed.kind === "ignored") return reply.code(200).send({ received: true, ignored: true });

      const requestIdHeader = req.headers["x-hifrica-request-id"];
      const entry: DemoConfirmation = {
        paymentId: parsed.paymentId,
        event: DEMO_EVENT,
        status: "succeeded",
        amount: parsed.amount,
        currency: parsed.currency,
        requestId: typeof requestIdHeader === "string" && isUuid(requestIdHeader) ? requestIdHeader : null,
        deliveryId: parsed.deliveryId,
        receivedAt: new Date(nowSec() * 1000).toISOString(),
      };
      let added: boolean;
      try {
        added = await store.add(projectId, entry);
      } catch (err) {
        req.log.error({ projectId, reason: err instanceof Error ? err.message : "store_error" }, "récepteur de démo : stockage indisponible");
        return fail(reply, 503, "unavailable", "Service momentanément indisponible, réessayez.");
      }
      return reply.code(200).send({ received: true, duplicate: !added });
    });

    scope.get<{ Params: { id: string } }>("/api/projects/:id/demo/webhooks", async (req, reply) => {
      const user = await getUser(req);
      if (!user) return fail(reply, 401, "unauthenticated", "Connectez-vous pour continuer.");
      if (!(await isOwner(user, req.params.id))) return fail(reply, 404, "project_not_found", "Projet introuvable.");
      reply.header("cache-control", "no-store");
      try {
        const stored = await store.list(req.params.id, DEMO_CONFIRMATIONS_LIMIT);
        return { confirmations: visibleConfirmations(stored, nowSec()) };
      } catch (err) {
        req.log.error({ reason: err instanceof Error ? err.message : "store_error" }, "récepteur de démo : lecture indisponible");
        return fail(reply, 503, "unavailable", "Service momentanément indisponible, réessayez.");
      }
    });
  });
}
