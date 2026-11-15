// Propriétaire : Dev C — page « Téléphone simulé » de la Console.
// Le téléphone simulé de B (SimulatedPhone, inchangé) et son cadre (DeviceFrame, C) sont réutilisés tels quels :
// même flux SSE du projet (GET /api/projects/:id/stream), même route d'action (POST /api/phone/:session/action),
// même PIN de démonstration contrôlé dans le navigateur. Aucune donnée créée ici, aucune confirmation propre à la
// page : elle permet seulement de valider les paiements créés par l'application du développeur, sans passer par la
// boutique de démonstration.
//
// Limite connue (pas d'API de liste) : le flux SSE ne relaie que les événements publiés pendant que la page est
// ouverte ; une demande créée avant son ouverture n'est pas récupérée. La page le dit explicitement.
import { rememberedKey } from "../api.js";
import { DeviceFrame } from "../components/DeviceFrame.js";
import { SimulatedPhone } from "../phone/SimulatedPhone.js";
import { useProjects } from "../projects.js";
import { Link } from "../router.js";
import { PageHead } from "../shell.js";
import { Alert, Icon } from "../ui.js";

/** Simulateur USSD composé depuis le téléphone (le même que dans la boutique de démonstration). */
const USSD_SIMULATOR = "mobile-money-ussd";
const USSD_CODE = "*123#";

export function PhonePage() {
  const { active } = useProjects();
  const project = active!;
  // Clé connue du navigateur seulement si elle a été créée ou saisie pendant la session : sans elle, pas de cadran USSD.
  const key = rememberedKey(project.id);

  return (
    <>
      <PageHead
        title="Téléphone simulé"
        description="Validez ou refusez ici les paiements que vos applications créent avec une clé de ce projet, comme le ferait votre client sur son téléphone."
      />
      <div className="row-nw" style={{ gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div className="panel" style={{ flex: "1 1 380px", minWidth: 0 }}>
          <div className="panel-head">
            <h2>Projet écouté</h2>
            <span className="live" data-testid="phone-listening">
              <span className="dot" /> À l'écoute des paiements de ce projet
            </span>
          </div>
          <div className="panel-body stack">
            <p style={{ marginBottom: 0, fontSize: "1.05rem" }}>
              <strong data-testid="phone-project-name">{project.name}</strong>
            </p>

            <Alert kind="warn">
              Ouvrez cette page avant de lancer un paiement. Les demandes créées avant son ouverture ne seront pas récupérées.
            </Alert>

            <div>
              <p style={{ margin: "0 0 0.4rem", fontWeight: 600 }}>Tester votre application</p>
              <ol className="muted" style={{ margin: 0, paddingLeft: "1.2rem", lineHeight: 1.7 }}>
                <li>Gardez cette page ouverte.</li>
                <li>Depuis votre application, créez un paiement avec une clé de ce projet.</li>
                <li>
                  La demande s'affiche sur le téléphone : <strong>Confirmer</strong>, saisissez le code, puis <strong>Valider</strong>.
                </li>
                <li>Votre serveur reçoit le webhook signé à l'URL configurée dans Paramètres.</li>
              </ol>
            </div>

            <p style={{ marginBottom: 0 }} data-testid="phone-pin">
              PIN de démonstration : <code>0000</code>. Tout autre code refuse le paiement. Le code n'est jamais envoyé au serveur.
            </p>

            {!key && (
              <p className="muted" style={{ marginBottom: 0, fontSize: "0.84rem" }}>
                USSD : pour composer {USSD_CODE} depuis ce téléphone, créez une clé de test pendant cette session (<Link to="/app/cles">Clés API</Link>).
              </p>
            )}

            <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
              <Link to="/app/cles" className="btn btn-sm">
                <Icon name="key" /> Clés API
              </Link>
              <Link to="/app/console" className="btn btn-sm">
                <Icon name="terminal" /> Console
              </Link>
              <Link to="/app/parametres" className="btn btn-sm">
                <Icon name="settings" /> Historique des webhooks
              </Link>
            </div>
          </div>
        </div>

        <div className="device-col">
          {/* key : un changement de projet actif remonte le téléphone (nouvel abonnement, aucune demande de l'ancien projet affichée). */}
          <DeviceFrame label="Téléphone simulé du projet">
            <SimulatedPhone
              key={project.id}
              projectId={project.id}
              testKey={key || undefined}
              ussdSimulator={key ? USSD_SIMULATOR : undefined}
              ussdCode={key ? USSD_CODE : undefined}
            />
          </DeviceFrame>
        </div>
      </div>
    </>
  );
}
