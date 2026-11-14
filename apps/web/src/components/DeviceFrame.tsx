// Propriétaire : Dev C
// Smartphone générique aux couleurs de Hifrica pour la boutique de démonstration : châssis, encoche (caméra
// frontale), barre de statut avec îlot de statut, horloge d'écran verrouillé, barre d'accueil. Aucune marque
// réelle reproduite : identité visuelle propre à Hifrica (logo, vert de la marque, polices de l'application).
//
// Le cadre est purement visuel : il ENVELOPPE le téléphone simulé de B (SimulatedPhone, inchangé), qui garde
// toute la logique (flux SSE unique, paiement, PIN, USSD, SMS/OTP). L'habillage en style mobile des éléments
// de B est fait en CSS (device-frame.css), par des sélecteurs limités à `.device` : aucune donnée n'est créée.
// Heure et date sont réelles ; réseau, Wi-Fi et batterie sont des icônes décoratives (aria-hidden), sans valeur.
// L'îlot de statut s'affiche seul pendant un paiement ou une session USSD (sélecteurs CSS sur l'état de B).
import { useEffect, useState, type ReactNode } from "react";
import "./device-frame.css";

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Recalé sur le début de chaque minute, pour que l'heure affichée change en même temps que l'horloge.
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const d = new Date();
      setNow(d);
      timer = setTimeout(tick, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50);
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return now;
}

const timeFmt = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dateFmt = (d: Date) => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

/** Icônes génériques (dessin Hifrica) : réseau en triangle, Wi-Fi en arcs tracés, batterie fine. */
function StatusIcons() {
  return (
    <span className="device-status-icons" aria-hidden="true">
      <svg viewBox="0 0 14 14" width="13" height="13">
        <path d="M13 1v12H1z" />
      </svg>
      <svg viewBox="0 0 16 14" width="15" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M2 5.4a8.6 8.6 0 0 1 12 0" />
        <path d="M4.6 8.2a4.9 4.9 0 0 1 6.8 0" />
        <circle cx="8" cy="11.3" r="1.1" fill="currentColor" stroke="none" />
      </svg>
      <svg viewBox="0 0 12 18" width="9" height="15">
        <rect x="3.5" y="0.5" width="5" height="2" rx="0.8" />
        <rect x="1" y="2.5" width="10" height="15" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <rect className="device-battery-fill" x="3" y="5" width="6" height="10.5" rx="1" />
      </svg>
    </span>
  );
}

export function DeviceFrame({ children, label = "Téléphone de démonstration" }: { children: ReactNode; label?: string }) {
  const now = useClock();
  return (
    <div className="device" role="group" aria-label={label}>
      <div className="device-chassis">
        <span className="device-btn device-btn-volume" aria-hidden="true" />
        <span className="device-btn device-btn-power" aria-hidden="true" />
        <div className="device-screen">
          <span className="device-notch" aria-hidden="true" />
          <div className="device-status" aria-hidden="true">
            <span className="device-status-left">
              <span className="device-status-time">{timeFmt(now)}</span>
              <span className="device-activity" />
            </span>
            <StatusIcons />
          </div>
          <div className="device-lock" aria-hidden="true">
            <span className="device-lock-brand">
              <img src="/logo.png" alt="" width={16} height={16} />
              Hifrica
            </span>
            <span className="device-lock-time">{timeFmt(now)}</span>
            <span className="device-lock-date">{dateFmt(now)}</span>
          </div>
          <div className="device-content">{children}</div>
          <span className="device-home" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
