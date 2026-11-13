// Propriétaire : Dev B
// Route SSE : relaie en temps réel les événements d'un projet (paiement, téléphone, USSD, SMS)
// publiés sur son canal Valkey (voir projectChannel, @hifrica/shared) vers le navigateur.
import { isHifricaEvent, projectChannel } from "@hifrica/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Redis } from "ioredis";
import { assertProjectOwner, requireUser, type AuthenticatedUser } from "./auth.js";

export interface SseDeps {
  requireUser: (req: FastifyRequest) => Promise<AuthenticatedUser | null>;
  assertProjectOwner: (user: AuthenticatedUser, projectId: string) => Promise<boolean>;
}

const defaultDeps: SseDeps = { requireUser, assertProjectOwner };

/** Exposé pour les tests seulement : remet les compteurs à zéro entre deux cas. */
export function resetStreamLimitsForTests(): void {
  perUser.clear();
  total = 0;
}

const PING_INTERVAL_MS = 25_000;
/** Chaque flux ouvre une connexion Valkey dédiée : ces limites évitent qu'un compte ou le serveur
 * entier en accumule trop (défense en profondeur, en mémoire — suffisant tant qu'il n'y a qu'un
 * processus API, comme le quota de l'assistant IA). */
const MAX_STREAMS_PER_USER = 5;
const MAX_STREAMS_TOTAL = 200;

const perUser = new Map<string, number>();
let total = 0;

function acquireSlot(userId: string): boolean {
  if (total >= MAX_STREAMS_TOTAL) return false;
  const current = perUser.get(userId) ?? 0;
  if (current >= MAX_STREAMS_PER_USER) return false;
  perUser.set(userId, current + 1);
  total += 1;
  return true;
}

function releaseSlot(userId: string): void {
  const current = perUser.get(userId) ?? 0;
  if (current <= 1) perUser.delete(userId);
  else perUser.set(userId, current - 1);
  total = Math.max(0, total - 1);
}

export function registerSse(app: FastifyInstance, deps: SseDeps = defaultDeps): void {
  app.get<{ Params: { id: string } }>("/api/projects/:id/stream", async (req, reply) => {
    const projectId = req.params.id;

    const user = await deps.requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const userId = user.id;

    // Avant toute requête ou connexion Valkey : chaque flux ouvert en coûte une, un compte ou un
    // serveur ne doit pas pouvoir en accumuler sans limite.
    if (!acquireSlot(userId)) return reply.code(429).send({ error: "too_many_streams" });
    let slotHeld = true;
    function releaseSlotOnce(): void {
      if (!slotHeld) return;
      slotHeld = false;
      releaseSlot(userId);
    }

    const owns = await deps.assertProjectOwner(user, projectId);
    // 404, pas 403 : ne révèle pas qu'un projet existe s'il n'appartient pas à l'utilisateur.
    // isUuid() est déjà vérifié dans assertProjectOwner (C2) : un :id mal formé finit ici en 404.
    if (!owns) {
      releaseSlotOnce();
      return reply.code(404).send({ error: "project_not_found" });
    }

    const valkeyUrl = process.env.VALKEY_URL;
    if (!valkeyUrl) {
      releaseSlotOnce();
      return reply.code(503).send({ error: "stream_unavailable" });
    }

    // Fastify ne gère plus la réponse à partir d'ici : on écrit nous-mêmes sur reply.raw.
    reply.hijack();
    const res = reply.raw;

    let closed = false;
    // Écrit seulement si la réponse est encore ouverte : le client a pu se déconnecter pendant que
    // connect()/subscribe() étaient encore en cours (avant que "close" n'ait eu le temps d'être écouté
    // plus bas), auquel cas écrire sur un socket déjà détruit lèverait une exception.
    function safeWrite(chunk: string): void {
      if (closed || res.destroyed) return;
      try {
        res.write(chunk);
      } catch {
        /* le client vient de partir entre la vérification et l'écriture : rien à faire */
      }
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    safeWrite(": connecté\n\n");

    const channel = projectChannel(projectId);
    // Connexion dédiée : une connexion ioredis abonnée (SUBSCRIBE) ne peut plus exécuter d'autre commande.
    const subscriber = new Redis(valkeyUrl, { maxRetriesPerRequest: null, lazyConnect: true });

    const ping = setInterval(() => safeWrite(": ping\n\n"), PING_INTERVAL_MS);

    function cleanup(): void {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      releaseSlotOnce();
      subscriber.unsubscribe(channel).catch(() => {});
      subscriber.quit().catch(() => {});
    }

    subscriber.on("message", (_channel: string, message: string) => {
      let payload: unknown;
      try {
        payload = JSON.parse(message);
      } catch {
        req.log.warn({ channel }, "message Valkey illisible, ignoré");
        return;
      }
      // Défense en profondeur : un éditeur ou un bug côté éditeur ne doit pas pouvoir pousser
      // n'importe quoi jusqu'au navigateur via ce canal.
      if (!isHifricaEvent(payload)) {
        req.log.warn({ channel }, "événement invalide reçu sur le canal, ignoré");
        return;
      }
      safeWrite(`event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`);
    });

    subscriber.on("error", (err: Error) => {
      req.log.error({ err: err.message, channel }, "Valkey injoignable (flux SSE)");
    });

    // Enregistré AVANT connect()/subscribe() : si le client part pendant que l'un des deux est encore
    // en cours, cleanup() tourne tout de suite (et closed=true empêche le bloc catch plus bas d'agir).
    req.raw.on("close", cleanup);

    try {
      await subscriber.connect();
      if (closed) return; // parti pendant connect() : cleanup() a déjà tout fermé, rien à continuer.
      await subscriber.subscribe(channel);
    } catch (err) {
      if (closed) return; // déjà nettoyé par la déconnexion du client : ne pas toucher à une réponse détruite.
      req.log.error({ err }, "connexion Valkey impossible pour le flux SSE");
      cleanup();
      if (!res.destroyed) res.end();
    }
  });
}
