// Propriétaire : Dev B
// Publication des événements temps réel (téléphone simulé, tableau de bord).
import { projectChannel, type HifricaEvent } from "@hifrica/shared";
import type { FastifyBaseLogger } from "fastify";

/** Publie un événement sur le canal du projet. */
export async function publishEvent(event: HifricaEvent, log: Pick<FastifyBaseLogger, "info"> = console): Promise<void> {
  // TODO(B1) publier sur Valkey.
  log.info({ channel: projectChannel(event.projectId), type: event.type }, "événement publié (bouchon)");
}
