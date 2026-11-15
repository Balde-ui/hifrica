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
  /** Échec du branchement (PATCH) : le bouton reste disponible pour réessayer. */
  const [error, setError] = useState<string | null>(null);
  /** Échec d'une lecture des confirmations : la lecture suivante est retentée automatiquement. */
  const [pollError, setPollError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<DemoConfirmation | null>(null);
  const [waiting, setWaiting] = useState<"idle" | "waiting" | "timeout">("idle");

  useEffect(() => {
    setConfirmReplace(false);
    setError(null);
  }, [projectId]);

  // Attente de la confirmation signée du paiement en cours (seulement si le récepteur est branché).
  useEffect(() => {
    setConfirmation(null);
    setPollError(null);
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
        setPollError(null);
        const found = r.confirmations.find((c) => c.paymentId === paymentId);
        if (found) {
          setConfirmation(found);
          setWaiting("idle");
          return;
        }
      } catch (err) {
        if (stopped) return;
        setPollError(errorMessage(err));
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

  const titleId = `demo-webhook-title-${projectId}`;
  return (
    // Action secondaire de la zone de paiement : séparée du bouton « Payer » et de même thème clair que la carte
    // (classes .demo-webhook*, .otp-btn de #26). Aucune confirmation n'est affichée sur un simple clic : seulement à
    // la réception d'un webhook dont l'API a vérifié la signature, pour l'identifiant de ce checkout.
    <section className="demo-webhook" data-testid="demo-webhook" aria-labelledby={titleId}>
      <div className="demo-webhook-head">
        <h4 id={titleId}>Confirmation automatique du paiement</h4>
        {connected && (
          <span className="demo-webhook-badge" data-testid="demo-webhook-connected">
            <span aria-hidden="true">●</span> Connectée
          </span>
        )}
      </div>

      {connected ? (
        <p className="demo-webhook-text">Les paiements validés sur le téléphone seront reçus par la boutique, signés par Hifrica.</p>
      ) : (
        <>
          <p className="demo-webhook-text">Connectez cette boutique aux webhooks du projet pour recevoir automatiquement la confirmation du paiement.</p>
          {webhookUrl && (
            <p className="demo-webhook-note" role={confirmReplace ? "alert" : undefined}>
              {confirmReplace ? "Confirmez le remplacement : " : "Une URL de webhook est déjà configurée pour ce projet : "}
              <code>{webhookUrl}</code>.{" "}
              {confirmReplace
                ? "Elle sera remplacée par le récepteur de la boutique (modifiable ensuite dans Paramètres)."
                : "Une confirmation vous sera demandée avant de la remplacer."}
            </p>
          )}
          <div className="demo-webhook-actions">
            <button type="button" className="otp-btn demo-webhook-btn" disabled={busy} aria-busy={busy} onClick={() => void connect()}>
              {busy ? (
                <>
                  <Spinner /> Connexion…
                </>
              ) : confirmReplace ? (
                "Confirmer : remplacer l'URL de webhook"
              ) : (
                "Recevoir les webhooks dans la boutique"
              )}
            </button>
            {confirmReplace && !busy && (
              <button type="button" className="demo-webhook-cancel" onClick={() => setConfirmReplace(false)}>
                Annuler
              </button>
            )}
          </div>
          {error && (
            <p className="demo-webhook-error" role="alert">
              Connexion impossible : {error} Réessayez.
            </p>
          )}
        </>
      )}

      {connected && waiting === "waiting" && (
        <p className="demo-webhook-status" role="status">
          <Spinner /> En attente du webhook signé : validez le paiement sur le téléphone.
        </p>
      )}
      {connected && waiting === "timeout" && (
        <p className="demo-webhook-status" role="status">
          Aucun webhook reçu pour ce paiement. Consultez l'historique des webhooks du projet.
        </p>
      )}
      {connected && pollError && waiting === "waiting" && (
        <p className="demo-webhook-error" role="alert">
          Lecture des confirmations impossible ({pollError}) : nouvel essai automatique.
        </p>
      )}
      {confirmation && (
        <div className="pay-result pay-ok" role="status" data-testid="demo-webhook-confirmed">
          <strong>Paiement confirmé par webhook</strong>
          <div style={{ marginTop: "0.2rem" }}>
            La boutique a reçu « {confirmation.event} » signé pour {String(confirmation.amount)} {confirmation.currency ?? ""} (paiement{" "}
            <code>{confirmation.paymentId.slice(0, 8)}…</code>, {new Date(confirmation.receivedAt).toLocaleTimeString("fr-FR")}). Signature vérifiée
            avec le secret du projet.
          </div>
        </div>
      )}
    </section>
  );
}
