// Propriétaire : Dev A
// Webhooks différés envoyés au serveur du client après une réponse de simulateur.
import type { FastifyBaseLogger } from "fastify";

export interface ScheduleWebhookOptions {
  projectId: string;
  simulator: string;
  requestId: string;
  event: string;
  body: unknown;
  delayMs: number;
}

/** Programme l'envoi d'un webhook au serveur du client. */
export async function scheduleWebhook(opts: ScheduleWebhookOptions, log: Pick<FastifyBaseLogger, "info"> = console): Promise<void> {
  // TODO(A2) file BullMQ + HMAC.
  log.info(
    {
      projectId: opts.projectId,
      simulator: opts.simulator,
      requestId: opts.requestId,
      event: opts.event,
      delayMs: opts.delayMs,
    },
    "webhook programmé (bouchon)",
  );
}
