// Propriétaire : Dev C
// Journalisation des requêtes reçues par le moteur.
import type { FastifyInstance, FastifyRequest } from "fastify";

function simulatorOf(request: FastifyRequest): string | undefined {
  const params: unknown = request.params;
  if (params && typeof params === "object" && "simulator" in params) {
    const value = (params as { simulator: unknown }).simulator;
    if (typeof value === "string") return value;
  }
  return undefined;
}

/** Enregistre les crochets de journalisation. À appeler avant la déclaration des routes. */
export function registerRequestLogging(app: FastifyInstance): void {
  // TODO(C4) onRequest/onError/onResponse/onRequestAbort + écriture dans
  // request_logs (outcome, status NULL si pas de réponse).
  app.addHook("onResponse", async (request, reply) => {
    app.log.info(
      {
        requestId: request.id,
        simulator: simulatorOf(request),
        method: request.method,
        path: request.url.split("?")[0],
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      "requête traitée",
    );
  });
}
