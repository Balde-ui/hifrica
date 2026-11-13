// Propriétaire : Dev B
// Route d'action du téléphone simulé : confirme ou rejette un paiement en attente (B1).
//
// Le PIN n'est jamais envoyé au serveur : c'est le composant React du téléphone (B2) qui décide
// localement si le code saisi est correct, puis appelle cette route avec l'issue déjà connue
// (action: "confirm" ou "reject", reason: "wrong_pin" éventuel). Rien de sensible ne transite ici.
import {
  isPhoneSession,
  PHONE_SESSION_TTL_SEC,
  phoneSessionKey,
  projectChannel,
  type PhoneConfirmEvent,
  type PhoneRejectEvent,
  type PhoneSession,
} from "@hifrica/shared";
import type { FastifyInstance } from "fastify";
import { assertProjectOwner, requireUser } from "./auth.js";
import { runCommand } from "./valkey.js";

const MAX_REASON_LENGTH = 64;

function actionLockKey(sessionId: string): string {
  return `${phoneSessionKey(sessionId)}:action`;
}

interface ActionBody {
  action?: unknown;
  reason?: unknown;
}

export function registerPhoneAction(app: FastifyInstance): void {
  app.post<{ Params: { session: string }; Body: ActionBody }>("/api/phone/:session/action", async (req, reply) => {
    const sessionId = req.params.session;
    const action = req.body?.action;
    if (action !== "confirm" && action !== "reject") {
      return reply.code(400).send({ error: "invalid_action" });
    }
    const rawReason = req.body?.reason;
    if (rawReason !== undefined && (typeof rawReason !== "string" || rawReason.length > MAX_REASON_LENGTH)) {
      return reply.code(400).send({ error: "invalid_reason" });
    }
    const reason = rawReason as string | undefined;

    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    let session: PhoneSession;
    try {
      const raw = await runCommand((c) => c.get(phoneSessionKey(sessionId)));
      if (raw === null) return reply.code(404).send({ error: "session_not_found" });
      const parsed: unknown = JSON.parse(raw);
      if (!isPhoneSession(parsed)) return reply.code(404).send({ error: "session_not_found" });
      session = parsed;
    } catch (err) {
      req.log.error({ err }, "lecture de la session de paiement impossible");
      return reply.code(503).send({ error: "stream_unavailable" });
    }

    // 404, pas 403 : ne révèle pas qu'une session existe si le projet n'appartient pas à l'utilisateur.
    const owns = await assertProjectOwner(user, session.projectId);
    if (!owns) return reply.code(404).send({ error: "session_not_found" });

    if (session.status !== "pending") return reply.code(409).send({ error: "already_handled" });

    // Verrou atomique : la première action reçue gagne (confirm ou reject, peu importe laquelle),
    // ce qui élimine toute course entre deux actions quasi simultanées sur la même session.
    let locked: string | null;
    try {
      locked = await runCommand((c) => c.set(actionLockKey(sessionId), action, "EX", PHONE_SESSION_TTL_SEC, "NX"));
    } catch (err) {
      req.log.error({ err }, "verrouillage de l'action impossible");
      return reply.code(503).send({ error: "stream_unavailable" });
    }
    if (locked === null) return reply.code(409).send({ error: "already_handled" });

    const status = action === "confirm" ? "confirmed" : "rejected";
    const updated: PhoneSession = { ...session, status };
    try {
      // KEEPTTL : la session garde le temps qu'il lui restait, pas un TTL de 600 s remis à zéro.
      await runCommand((c) => c.set(phoneSessionKey(sessionId), JSON.stringify(updated), "KEEPTTL"));
    } catch (err) {
      req.log.error({ err }, "mise à jour du statut de la session impossible");
      return reply.code(503).send({ error: "stream_unavailable" });
    }

    const createdAt = new Date().toISOString();
    const event: PhoneConfirmEvent | PhoneRejectEvent =
      action === "confirm"
        ? { type: "phone.confirm", sessionId, projectId: session.projectId, createdAt, requestId: req.id }
        : {
            type: "phone.reject",
            sessionId,
            projectId: session.projectId,
            createdAt,
            requestId: req.id,
            ...(reason !== undefined ? { reason } : {}),
          };

    // La session est déjà à jour : un échec de publication n'invalide pas la décision de l'utilisateur,
    // mais A4 ne la verra pas tout de suite (même logique que startPaymentSession côté moteur).
    try {
      await runCommand((c) => c.publish(projectChannel(session.projectId), JSON.stringify(event)));
    } catch (err) {
      req.log.error({ err }, "publication de l'événement impossible");
    }

    return reply.code(200).send({ status });
  });
}
