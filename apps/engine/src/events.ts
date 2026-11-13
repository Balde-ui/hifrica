// Propriétaire : Dev B
// Publication des événements temps réel (téléphone simulé, tableau de bord) sur le canal Valkey du projet.
import { projectChannel, type HifricaEvent } from "@hifrica/shared";
import type { FastifyBaseLogger } from "fastify";
import { runCommand } from "./valkey.js";

/**
 * Publie un événement sur project:{id}:events. Lève si Valkey est injoignable ou n'est pas configuré :
 * les appelants (ex. startPaymentSession) attrapent déjà l'erreur pour ne jamais faire échouer la requête HTTP.
 */
export async function publishEvent(event: HifricaEvent, log: Pick<FastifyBaseLogger, "info"> = console): Promise<void> {
  const channel = projectChannel(event.projectId);
  await runCommand((c) => c.publish(channel, JSON.stringify(event)));
  log.info({ channel, type: event.type }, "événement publié");
}
