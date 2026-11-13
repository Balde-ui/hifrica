// Propriétaire : Dev A (A5)
// Historique des webhooks d'un projet (table webhook_deliveries, écrite par le moteur) pour la console.
// Mêmes règles d'accès que les routes de la plateforme (C) : 401 sans session, 404 si le projet n'est pas
// à l'utilisateur (sans révéler s'il existe).
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { safeDbCall, toApiId, webhookDeliveries, type Database } from "@hifrica/db";
import { assertProjectOwner, requireUser, type AuthenticatedUser } from "./auth.js";

export const DELIVERIES_LIMIT = 50;

export interface WebhookDeliveryView {
  id: string;
  deliveryId: string;
  requestId: string | null;
  event: string;
  attempt: number;
  outcome: string;
  statusCode: number | null;
  durationMs: number;
  destinationHost: string | null;
  createdAt: string;
}

export interface WebhookDeliveryRoutesOptions {
  db?: Database;
  /** Lecture des tentatives (remplaçable dans les tests). */
  list?: (projectId: string, limit: number) => Promise<WebhookDeliveryView[]>;
  requireUser?: (req: FastifyRequest) => Promise<AuthenticatedUser | null>;
  assertProjectOwner?: (user: AuthenticatedUser, projectId: string) => Promise<boolean>;
}

function listFromDb(db: Database) {
  return async (projectId: string, limit: number): Promise<WebhookDeliveryView[]> => {
    const rows = await safeDbCall("list_webhook_deliveries", () =>
      db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.projectId, projectId))
        .orderBy(desc(webhookDeliveries.id))
        .limit(limit),
    );
    return rows.map((r) => ({
      id: toApiId(r.id),
      deliveryId: r.deliveryId,
      requestId: r.requestId,
      event: r.event,
      attempt: r.attempt,
      outcome: r.outcome,
      statusCode: r.statusCode,
      durationMs: r.durationMs,
      destinationHost: r.destinationHost,
      createdAt: r.createdAt.toISOString(),
    }));
  };
}

export function registerWebhookDeliveryRoutes(app: FastifyInstance, opts: WebhookDeliveryRoutesOptions): void {
  const list = opts.list ?? (opts.db ? listFromDb(opts.db) : null);
  if (!list) throw new Error("registerWebhookDeliveryRoutes : db ou list requis");
  const getUser = opts.requireUser ?? requireUser;
  const isOwner = opts.assertProjectOwner ?? assertProjectOwner;

  app.get<{ Params: { id: string } }>("/api/projects/:id/webhook-deliveries", async (req, reply) => {
    const user = await getUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated", message: "Connectez-vous pour continuer." });
    if (!(await isOwner(user, req.params.id))) {
      return reply.code(404).send({ error: "project_not_found", message: "Projet introuvable." });
    }
    reply.header("cache-control", "no-store");
    return { deliveries: await list(req.params.id, DELIVERIES_LIMIT) };
  });
}
