// Propriétaire : Dev B
// Téléphone simulé (B2) : notification de paiement (confirmer/refuser), boîte SMS, écran USSD.
//
// Paiement et SMS arrivent en direct par SSE (GET /api/projects/:id/stream, B1) : le téléphone n'a besoin
// d'aucune clé pour ça, seulement de la session du navigateur (même origine, cookie Better Auth).
// L'USSD est une conversation que le téléphone mène lui-même (composer puis répondre) via le proxy
// générique /api/projects/:id/send (propriété de C) : d'où testKey + ussdSimulator en props.
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api.js";
import { Icon, Spinner } from "../ui.js";

const CORRECT_PIN = "0000";
const MAX_SMS = 20;

interface PendingPayment {
  sessionId: string;
  amount: number;
  currency?: string;
  merchant?: string;
  text: string;
}

interface SmsMessage {
  id: string;
  from: string;
  text: string;
  at: string;
}

interface UssdState {
  sessionId: string;
  text: string;
  end: boolean;
}

export interface SimulatedPhoneProps {
  /** Projet dont on écoute les événements (paiement, SMS). */
  projectId: string;
  /** Clé sk_test_ du projet, utilisée uniquement pour composer un appel USSD (proxy /send de C). */
  testKey?: string;
  /** Slug du simulateur USSD à composer (ex. "mobile-money-ussd") ; absent = pas de cadran affiché. */
  ussdSimulator?: string;
  /** Code à afficher sur le bouton (ex. "*123#", champ `code` du YAML) — distinct du slug ci-dessus. */
  ussdCode?: string;
}

/** Réponse du proxy /api/projects/:id/send : status/body sont ceux du MOTEUR, pas du proxy lui-même
 * (le proxy répond toujours 200 ; un échec côté moteur — 400/401/404/503 — arrive donc ici, pas via
 * une ApiError). Sans ce contrôle, un échec du moteur laissait l'écran USSD vide. */
interface EngineSendResult {
  status: number;
  body: unknown;
}

function engineErrorMessage(body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const code = (body as { error: unknown }).error;
    if (typeof code === "string") {
      const KNOWN: Record<string, string> = {
        invalid_test_key: "Clé de test invalide ou révoquée.",
        simulator_not_found: "Simulateur USSD introuvable.",
        input_too_long: "Réponse trop longue (182 caractères maximum).",
        stream_unavailable: "Service temporairement indisponible.",
      };
      return KNOWN[code] ?? `Erreur du simulateur (${code}).`;
    }
  }
  return "Erreur inattendue du simulateur USSD.";
}

type PinStep = { sessionId: string } | null;

export function SimulatedPhone({ projectId, testKey, ussdSimulator, ussdCode }: SimulatedPhoneProps) {
  const [payment, setPayment] = useState<PendingPayment | null>(null);
  const [pinStep, setPinStep] = useState<PinStep>(null);
  const [pin, setPin] = useState("");
  const [sms, setSms] = useState<SmsMessage[]>([]);
  const [ussd, setUssd] = useState<UssdState | null>(null);
  const [ussdReply, setUssdReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function flash(message: string) {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }

  // Paiement et SMS : poussés par le moteur/l'API sur le canal du projet, jamais sollicités par le téléphone.
  useEffect(() => {
    if (!projectId) return undefined;
    const source = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/stream`);

    const onPending = (e: MessageEvent) => {
      const d = JSON.parse(e.data) as { sessionId: string; amount: number; currency?: string; merchant?: string; text: string };
      setPayment({ sessionId: d.sessionId, amount: d.amount, currency: d.currency, merchant: d.merchant, text: d.text });
      setPinStep(null);
      setPin("");
    };
    const onSettled = (e: MessageEvent) => {
      const d = JSON.parse(e.data) as { sessionId: string };
      setPayment((p) => (p?.sessionId === d.sessionId ? null : p));
      setPinStep((s) => (s?.sessionId === d.sessionId ? null : s));
    };
    const onSms = (e: MessageEvent) => {
      const d = JSON.parse(e.data) as { messageId: string; from: string; text: string; createdAt: string };
      setSms((list) => [{ id: d.messageId, from: d.from, text: d.text, at: d.createdAt }, ...list].slice(0, MAX_SMS));
    };

    source.addEventListener("payment.pending", onPending);
    source.addEventListener("phone.confirm", onSettled);
    source.addEventListener("phone.reject", onSettled);
    source.addEventListener("sms.received", onSms);
    // Une erreur de flux (réseau, 401 après expiration) : EventSource retente seul ; rien à faire ici.

    return () => source.close();
  }, [projectId]);

  async function sendAction(sessionId: string, action: "confirm" | "reject", reason?: string) {
    setBusy(true);
    try {
      await api(`/api/phone/${encodeURIComponent(sessionId)}/action`, { body: { action, ...(reason ? { reason } : {}) } });
      flash(action === "confirm" ? "Paiement confirmé." : reason === "wrong_pin" ? "Code incorrect : paiement refusé." : "Paiement refusé.");
    } catch (err) {
      flash(errorMessage(err));
    } finally {
      setBusy(false);
      setPayment((p) => (p?.sessionId === sessionId ? null : p));
      setPinStep((s) => (s?.sessionId === sessionId ? null : s));
      setPin("");
    }
  }

  function submitPin() {
    if (!pinStep) return;
    void sendAction(pinStep.sessionId, pin === CORRECT_PIN ? "confirm" : "reject", pin === CORRECT_PIN ? undefined : "wrong_pin");
  }

  async function dialUssd() {
    if (!ussdSimulator || !testKey) return;
    setBusy(true);
    try {
      const r = await api<EngineSendResult>(`/api/projects/${encodeURIComponent(projectId)}/send`, {
        body: { key: testKey, simulator: ussdSimulator, method: "POST", path: "/ussd", body: { text: "" } },
      });
      if (r.status < 200 || r.status >= 300) {
        flash(engineErrorMessage(r.body));
        return;
      }
      setUssd(r.body as UssdState);
    } catch (err) {
      flash(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function replyUssd() {
    if (!ussd || !ussdSimulator || !testKey) return;
    const text = ussdReply;
    setBusy(true);
    try {
      const r = await api<EngineSendResult>(`/api/projects/${encodeURIComponent(projectId)}/send`, {
        body: { key: testKey, simulator: ussdSimulator, method: "POST", path: "/ussd", body: { sessionId: ussd.sessionId, text } },
      });
      if (r.status < 200 || r.status >= 300) {
        flash(engineErrorMessage(r.body));
        return;
      }
      const body = r.body as UssdState;
      setUssd(body.end ? null : body);
      if (body.end) flash(body.text);
      setUssdReply("");
    } catch (err) {
      flash(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const currency = payment?.currency ?? "XOF";
  const amount = payment ? payment.amount.toLocaleString("fr-FR") : "";

  return (
    <div className="phone">
      <div className="phone-head">
        <Icon name="phone" size={16} /> Téléphone simulé
      </div>
      <div className="phone-screen">
        {payment && !pinStep && (
          <div className="phone-card">
            <p className="phone-amount">{amount} {currency}</p>
            <p>{payment.text}</p>
            <div className="row" style={{ gap: "0.5rem", marginTop: "0.8rem" }}>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => setPinStep({ sessionId: payment.sessionId })}>
                Confirmer
              </button>
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void sendAction(payment.sessionId, "reject")}>
                Refuser
              </button>
            </div>
          </div>
        )}

        {payment && pinStep && (
          <div className="phone-card">
            <p>Entrez votre code secret pour payer {amount} {currency}</p>
            <p className="muted" style={{ fontSize: "0.72rem" }}>
              Démo : <code>0000</code> confirme, tout autre code refuse le paiement.
            </p>
            <input
              className="input mono"
              type="password"
              inputMode="numeric"
              maxLength={4}
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              onKeyDown={(e) => e.key === "Enter" && pin.length === 4 && submitPin()}
              placeholder="····"
            />
            <div className="row" style={{ gap: "0.5rem", marginTop: "0.8rem" }}>
              <button className="btn btn-primary btn-sm" disabled={busy || pin.length !== 4} onClick={submitPin}>
                {busy ? <Spinner /> : "Valider"}
              </button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setPinStep(null)}>
                Retour
              </button>
            </div>
          </div>
        )}

        {!payment && ussd && (
          <div className="phone-card">
            <pre className="phone-ussd-text">{ussd.text}</pre>
            {!ussd.end && (
              <div className="row" style={{ gap: "0.5rem", marginTop: "0.6rem" }}>
                <input
                  className="input mono"
                  value={ussdReply}
                  onChange={(e) => setUssdReply(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void replyUssd()}
                  placeholder="Votre réponse…"
                  autoFocus
                />
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void replyUssd()}>
                  Envoyer
                </button>
              </div>
            )}
          </div>
        )}

        {!payment && !ussd && (
          <div className="phone-card phone-idle">
            {ussdSimulator ? (
              <button className="btn btn-ghost btn-sm" disabled={busy || !testKey} onClick={() => void dialUssd()}>
                Composer {ussdCode ?? "le code USSD"}
              </button>
            ) : (
              <span className="muted">En attente d'un événement…</span>
            )}
          </div>
        )}

        {notice && <div className="phone-toast">{notice}</div>}
      </div>

      <div className="phone-sms">
        <div className="phone-sms-head">
          <Icon name="info" size={14} /> SMS {sms.length > 0 && <span className="muted">({sms.length})</span>}
        </div>
        {sms.length === 0 ? (
          <p className="muted phone-sms-empty">Aucun SMS reçu.</p>
        ) : (
          <ul className="phone-sms-list">
            {sms.map((m) => (
              <li key={m.id}>
                <strong>{m.from}</strong>
                <span>{m.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
