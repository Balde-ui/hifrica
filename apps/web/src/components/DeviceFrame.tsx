// Propriétaire : Dev C
// Cadre de smartphone pour la boutique de démonstration : châssis, Dynamic Island, barre de statut, écran
// verrouillé (heure et date réelles), barre d'accueil. Inspiré d'un smartphone récent, sans logo ni marque.
//
// Le cadre est purement visuel : il ENVELOPPE le téléphone simulé de B (SimulatedPhone, inchangé), qui garde
// toute la logique (flux SSE unique, paiement, PIN, USSD, SMS/OTP). L'habillage iOS des éléments de B est fait
// en CSS (device-frame.css), par des sélecteurs limités à `.device` : aucune donnée n'est créée ici.
// Réseau, Wi-Fi et batterie sont des icônes décoratives (aria-hidden), sans valeur inventée.
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

function StatusIcons() {
  return (
    <span className="device-status-icons" aria-hidden="true">
      {/* Réseau */}
      <svg viewBox="0 0 18 12" width="17" height="11">
        <rect x="0" y="8" width="3" height="4" rx="1" />
        <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
        <rect x="10" y="3" width="3" height="9" rx="1" />
        <rect x="15" y="0" width="3" height="12" rx="1" />
      </svg>
      {/* Wi-Fi */}
      <svg viewBox="0 0 16 12" width="15" height="11">
        <path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0z" />
        <path d="M3.4 6.8a6.5 6.5 0 0 1 9.2 0l-1.4 1.4a4.5 4.5 0 0 0-6.4 0z" />
        <path d="M1.1 4.5a9.7 9.7 0 0 1 13.8 0l-1.4 1.4a7.7 7.7 0 0 0-11 0z" />
      </svg>
      {/* Batterie */}
      <svg viewBox="0 0 27 13" width="25" height="12">
        <rect x="0.6" y="0.6" width="22.8" height="11.8" rx="3.4" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.2" />
        <rect x="2.4" y="2.4" width="19.2" height="8.2" rx="2" />
        <path d="M25 4.3v4.4a2.3 2.3 0 0 0 0-4.4z" fillOpacity="0.45" />
      </svg>
    </span>
  );
}

export function DeviceFrame({ children, label = "Téléphone de démonstration" }: { children: ReactNode; label?: string }) {
  const now = useClock();
  return (
    <div className="device" role="group" aria-label={label}>
      <div className="device-chassis">
        <span className="device-btn device-btn-action" aria-hidden="true" />
        <span className="device-btn device-btn-vol-up" aria-hidden="true" />
        <span className="device-btn device-btn-vol-down" aria-hidden="true" />
        <span className="device-btn device-btn-power" aria-hidden="true" />
        <div className="device-screen">
          <div className="device-island" aria-hidden="true">
            <span className="device-island-cam" />
            <span className="device-island-live" />
          </div>
          <div className="device-status" aria-hidden="true">
            <span className="device-status-time">{timeFmt(now)}</span>
            <StatusIcons />
          </div>
          <div className="device-lock" aria-hidden="true">
            <span className="device-lock-date">{dateFmt(now)}</span>
            <span className="device-lock-time">{timeFmt(now)}</span>
          </div>
          <div className="device-content">{children}</div>
          <span className="device-home" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
