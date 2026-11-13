// Propriétaire : Dev B
// Route SSE : relaie en temps réel les événements d'un projet (paiement, téléphone, USSD, SMS)
// publiés sur son canal Valkey (voir projectChannel, @hifrica/shared) vers le navigateur.
import { isHifricaEvent, projectChannel } from "@hifrica/shared";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { assertProjectOwner, requireUser } from "./auth.js";

const PING_INTERVAL_MS = 25_000;

export function registerSse(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>("/api/projects/:id/stream", async (req, reply) => {
    const projectId = req.params.id;

    const user = await requireUser(req);
    const owns = await assertProjectOwner(user, projectId);
    // 404, pas 403 : ne révèle pas qu'un projet existe s'il n'appartient pas à l'utilisateur.
    if (!owns) return reply.code(404).send({ error: "project_not_found" });

    const valkeyUrl = process.env.VALKEY_URL;
    if (!valkeyUrl) return reply.code(503).send({ error: "stream_unavailable" });

    // Fastify ne gère plus la réponse à partir d'ici : on écrit nous-mêmes sur reply.raw.
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connecté\n\n");

    const channel = projectChannel(projectId);
    // Connexion dédiée : une connexion ioredis abonnée (SUBSCRIBE) ne peut plus exécuter d'autre commande.
    const subscriber = new Redis(valkeyUrl, { maxRetriesPerRequest: null, lazyConnect: true });

    const ping = setInterval(() => res.write(": ping\n\n"), PING_INTERVAL_MS);

    let closed = false;
    function cleanup(): void {
      if (closed) return;
      closed = true;
      clearInterval(ping);
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
      res.write(`event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`);
    });

    subscriber.on("error", (err: Error) => {
      req.log.error({ err: err.message, channel }, "Valkey injoignable (flux SSE)");
    });

    req.raw.on("close", cleanup);

    try {
      await subscriber.connect();
      await subscriber.subscribe(channel);
    } catch (err) {
      req.log.error({ err }, "connexion Valkey impossible pour le flux SSE");
      cleanup();
      res.end();
    }
  });
}
