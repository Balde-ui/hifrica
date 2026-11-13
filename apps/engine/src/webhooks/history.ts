// Propriétaire : Dev A
// Historique des webhooks (A-5) : une ligne par tentative dans webhook_deliveries, lue par la console.
// Seulement l'hôte de destination : jamais l'URL complète, le corps, le secret ni la signature.
import { isUuid, safeDbCall, webhookDeliveries, type Database, type WebhookOutcome } from "@hifrica/db";

export interface DeliveryRecord {
  deliveryId: string;
  projectId: string;
  requestId: string;
  event: string;
  attempt: number;
  outcome: WebhookOutcome;
  statusCode: number | null;
  durationMs: number;
  destinationHost: string | null;
}

/** Enregistre une tentative ; sans base, ou pour un projet qui n'est pas en base (bouchon « demo »), ne fait rien. */
export function createDeliveryRecorder(getDb: () => Database | null): (row: DeliveryRecord) => Promise<void> {
  return async (row) => {
    const db = getDb();
    if (!db || !isUuid(row.projectId) || !isUuid(row.deliveryId)) return;
    await safeDbCall("insert_webhook_delivery", () =>
      db
        .insert(webhookDeliveries)
        .values({
          deliveryId: row.deliveryId,
          projectId: row.projectId,
          // request_id est un uuid (A-3) ; un identifiant d'une autre forme n'est pas enregistré.
          requestId: isUuid(row.requestId) ? row.requestId : null,
          event: row.event.slice(0, 200),
          attempt: row.attempt,
          outcome: row.outcome,
          statusCode: row.statusCode,
          durationMs: Math.max(0, Math.round(row.durationMs)),
          destinationHost: row.destinationHost ? row.destinationHost.slice(0, 253) : null,
        })
        // Une tentative rejouée (job BullMQ bloqué) n'est pas enregistrée deux fois.
        .onConflictDoNothing({ target: [webhookDeliveries.deliveryId, webhookDeliveries.attempt] }),
    );
  };
}
