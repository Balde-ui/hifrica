// Propriétaire : Dev C (C6) — réception des webhooks par la boutique de démonstration.
// Aucune donnée simulée ici : le bouton règle l'URL de webhook DU projet (PATCH /api/projects/:id, réservé
// au propriétaire) sur le récepteur C6 de la boutique (POST /api/demo/webhooks/:projectId). Le moteur (A5)
// y envoie alors le vrai webhook signé quand le client valide le paiement sur le téléphone ; l'API vérifie
// la signature avec le secret du projet avant de garder la confirmation. La boutique lit ensuite
// GET /api/projects/:id/demo/webhooks (propriétaire seulement) et n'annonce « confirmé » que si l'identifiant
// du paiement signé est celui renvoyé par son propre checkout.
import { useEffect, useState } from "react";
import { api, errorMessage, type DemoConfirmation } from "../api.js";
import { Spinner } from "../ui.js";

/** Intervalle de lecture des confirmations, et durée maximale d'attente après un checkout. */
const POLL_MS = 2_000;
const WAIT_MS = 5 * 60_000;

export function demoReceiverUrl(projectId: string, origin: string = window.location.origin): string {
  return `${origin.replace(/\/$/, "")}/api/demo/webhooks/${projectId}`;
}

export function DemoWebhookReceiver({
  projectId,
  webhookUrl,
  paymentId,
  onWebhookUrl,
}: {
  projectId: string;
  /** URL de webhook actuelle du projet (null : aucune). */
  webhookUrl: string | null;
  /** Identifiant renvoyé par le checkout (réponse 201), en attente de confirmation. */
  paymentId: string | null;
  onWebhookUrl: (url: string | null) => void;
}) {
  const receiver = demoReceiverUrl(projectId);
  const connected = webhookUrl === receiver;
  const [busy, setBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<DemoConfirmation | null>(null);
  const [waiting, setWaiting] = useState<"idle" | "waiting" | "timeout">("idle");

  useEffect(() => {
    setConfirmReplace(false);
    setError(null);
  }, [projectId]);

  // Attente de la confirmation signée du paiement en cours (seulement si le récepteur est branché).
  useEffect(() => {
    setConfirmation(null);
    if (!paymentId || !connected) {
      setWaiting("idle");
      return;
    }
    setWaiting("waiting");
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + WAIT_MS;
    const ctrl = new AbortController();
    async function poll() {
      try {
        const r = await api<{ confirmations: DemoConfirmation[] }>(`/api/projects/${projectId}/demo/webhooks`, { signal: ctrl.signal });
        if (stopped) return;
        const found = r.confirmations.find((c) => c.paymentId === paymentId);
        if (found) {
          setConfirmation(found);
          setWaiting("idle");
          return;
        }
      } catch (err) {
        if (stopped) return;
        setError(errorMessage(err));
      }
      if (Date.now() >= deadline) {
        setWaiting("timeout");
        return;
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    }
    void poll();
    return () => {
      stopped = true;
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [projectId, paymentId, connected]);

  async function connect() {
    if (webhookUrl && !connected && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}`, { method: "PATCH", body: { webhookUrl: receiver } });
      onWebhookUrl(receiver);
      setConfirmReplace(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="demo-webhook" data-testid="demo-webhook" style={{ marginTop: "0.8rem", fontSize: "0.78rem", color: "#5b616a" }}>
      {connected ? (
        <p style={{ margin: 0 }}>
          <span aria-hidden="true">● </span>
          Webhooks reçus par la boutique : les paiements validés sur le téléphone arrivent ici, signés par Hifrica.
        </p>
      ) : (
        <>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void connect()} style={{ width: "100%" }}>
            {busy ? <Spinner /> : confirmReplace ? "Confirmer : remplacer l'URL de webhook" : "Recevoir les webhooks dans la boutique"}
          </button>
          <p style={{ margin: "0.35rem 0 0" }}>
            {confirmReplace ? (
              <>
                Le projet envoie déjà ses webhooks à <code style={{ wordBreak: "break-all" }}>{webhookUrl}</code>. Cette URL sera remplacée par le
                récepteur de la boutique (modifiable ensuite dans Paramètres).
              </>
            ) : (
              "Règle l'URL de webhook du projet sur la boutique, pour afficher la confirmation signée du paiement."
            )}
          </p>
        </>
      )}
      {connected && waiting === "waiting" && (
        <p style={{ margin: "0.35rem 0 0" }} role="status">
          <Spinner /> En attente du webhook signé : validez le paiement sur le téléphone.
        </p>
      )}
      {connected && waiting === "timeout" && (
        <p style={{ margin: "0.35rem 0 0" }} role="status">
          Aucun webhook reçu pour ce paiement. Consultez l'historique des webhooks du projet.
        </p>
      )}
      {confirmation && (
        <div className="pay-result pay-ok" role="status" data-testid="demo-webhook-confirmed" style={{ marginTop: "0.5rem" }}>
          <strong>Paiement confirmé par webhook</strong>
          <div style={{ marginTop: "0.2rem" }}>
            La boutique a reçu « {confirmation.event} » signé pour {String(confirmation.amount)} {confirmation.currency ?? ""} (paiement{" "}
            <code>{confirmation.paymentId.slice(0, 8)}…</code>, {new Date(confirmation.receivedAt).toLocaleTimeString("fr-FR")}). Signature vérifiée
            avec le secret du projet.
          </div>
        </div>
      )}
      {error && <p style={{ margin: "0.35rem 0 0", color: "#c0392b" }}>{error}</p>}
    </div>
  );
}
