// Propriétaire : Dev C
// Journalisation des requêtes reçues par le moteur.
// Ne jamais journaliser l'en-tête Authorization, la query ni les corps de requête/réponse.
import type { FastifyInstance } from "fastify";
import "./context.js"; // déclare request.hifrica

/** Enregistre les crochets de journalisation. À appeler avant la déclaration des routes. */
export function registerRequestLogging(app: FastifyInstance): void {
  // TODO(C4) onRequest/onError/onResponse/onRequestAbort + écriture dans
  // request_logs (outcome, status NULL si pas de réponse).
  app.addHook("onResponse", async (request, reply) => {
    const ctx = request.hifrica; // null pour /health ou un simulateur inconnu
    app.log.info(
      {
        requestId: request.id,
        simulator: ctx?.simulator,
        channel: ctx?.channel,
        projectId: ctx?.projectId,
        apiKeyId: ctx?.apiKeyId,
        endpointId: ctx?.endpointId,
        scenarioKey: ctx?.scenarioKey,
        method: request.method,
        path: request.url.split("?")[0],
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      "requête traitée",
    );
  });
}
