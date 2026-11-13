// Accueil : héros inspiré de prisma.io (cadre, titre centré, puces, boutons pilule, maquette produit),
// reste de la page inspiré de supabase.com (navigation, grille « bento », titres bicolores, pied de page).
// Contenu propre à Hifrica ; aucune statistique inventée.
import type { ReactNode } from "react";
import { Link } from "../router.js";
import { useSession } from "../session.js";
import { Logo } from "../shell.js";
import { Icon, type IconName } from "../ui.js";
import { AiArt, CatalogueArt, ConsoleArt, EditorArt, KeysArt, ScenarioArt, SecurityArt } from "./landingArt.js";

function SiteNav() {
  const { user } = useSession();
  return (
    <header className="p-nav">
      <Link to="/" className="brand">
        <Logo /> Hifrica
      </Link>
      <nav className="p-links" aria-label="Navigation">
        <Link to="/catalogue">Catalogue</Link>
        <Link to="/editeur">Éditeur</Link>
        <Link to={user ? "/demo" : "/inscription"}>Démo</Link>
        <Link to={user ? "/app/console" : "/inscription"}>Console</Link>
      </nav>
      <div className="p-actions">
        {user ? (
          <Link to="/app" className="pill pill-solid pill-sm">
            Tableau de bord
          </Link>
        ) : (
          <>
            <Link to="/connexion" className="p-login">
              Se connecter
            </Link>
            <Link to="/inscription" className="pill pill-solid pill-sm">
              Commencer
            </Link>
          </>
        )}
      </div>
    </header>
  );
}

const MOCK_ROWS = [
  { status: 201, method: "POST", path: "/paiement-mobile-generique/v1/checkout", scenario: null, ms: 24 },
  { status: 402, method: "POST", path: "/paiement-mobile-generique/v1/checkout", scenario: "solde-insuffisant", ms: 9 },
  { status: 200, method: "GET", path: "/paiement-mobile-generique/v1/checkout/{id}", scenario: null, ms: 7 },
  { status: 401, method: "POST", path: "/paiement-mobile-generique/v1/checkout", scenario: null, ms: 3 },
];

function ProductMock() {
  const side: [IconName, string, boolean][] = [
    ["home", "Vue d'ensemble", false],
    ["key", "Clés API", false],
    ["terminal", "Console", true],
    ["layers", "Simulateurs", false],
    ["grid", "Catalogue", false],
  ];
  return (
    <div className="mock" aria-label="Aperçu de la console Hifrica (exemple)">
      <div className="mock-top">
        <span className="mock-url">app.hifrica.site</span>
      </div>
      <div className="mock-body">
        <div className="mock-side">
          {side.map(([icon, label, on]) => (
            <span key={label} className={on ? "on" : ""}>
              <Icon name={icon} /> {label}
            </span>
          ))}
        </div>
        <div className="mock-main">
          <span className="mock-kicker">
            <Icon name="terminal" size={13} /> Console · exemple
          </span>
          <div style={{ fontSize: "1rem", color: "var(--text)", margin: "0.4rem 0 1rem" }}>Chaque requête de votre app, en direct</div>
          {MOCK_ROWS.map((r, i) => (
            <div key={i} className="mock-row">
              <span className={`status-code s${String(r.status)[0]}`}>{r.status}</span>
              <span className="m-hide">
                <span className={`method method-${r.method}`}>{r.method}</span>
              </span>
              <span className="mono xs truncate" style={{ color: "var(--text-2)" }}>
                {r.path}
              </span>
              <span className="m-hide">{r.scenario ? <span className="badge badge-warn">{r.scenario}</span> : <span className="xs muted">nominal</span>}</span>
              <span className="xs muted" style={{ textAlign: "right" }}>
                {r.ms} ms
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Bento({ icon, title, children, visual, className = "" }: { icon: IconName; title: string; children: ReactNode; visual?: ReactNode; className?: string }) {
  return (
    <div className={`bento ${className}`}>
      <div className="bento-head">
        <Icon name={icon} /> {title}
      </div>
      <p className="bento-text">{children}</p>
      {visual && <div className="bento-visual">{visual}</div>}
    </div>
  );
}

export function Landing() {
  const { user } = useSession();
  const start = user ? "/app" : "/inscription";
  return (
    <div className="site">
      <section className="hero-frame">
        <SiteNav />
        <div className="hero-center">
          <h1 className="hero-title">
            Votre app de paiement mobile,
            <br />
            du test à la production
          </h1>
          <p className="hero-sub">
            Hifrica simule les API de paiement mobile, l'USSD et les SMS à partir de fichiers YAML communautaires. Votre app reçoit de vraies
            réponses et des webhooks signés, et vous jouez chaque scénario d'échec avant vos clients.
          </p>
          <ul className="hero-points">
            {(
              [
                ["#2dd4bf", "Sans compte marchand"],
                ["#facc15", "Scénarios d'échec en un clic"],
                ["#f43f5e", "Gratuit et open source"],
              ] as const
            ).map(([color, label]) => (
              <li key={label}>
                <span style={{ color, display: "inline-flex" }}>
                  <Icon name="check" />
                </span>
                {label}
              </li>
            ))}
          </ul>
          <div className="hero-cta">
            <Link to={start} className="pill pill-primary">
              {user ? "Ouvrir le tableau de bord" : "Démarrer gratuitement"}
            </Link>
            <Link to="/catalogue" className="pill pill-ghost">
              Parcourir le catalogue
            </Link>
          </div>
          <div className="hero-trust">
            <span>
              Projet <strong>CADEV 2026</strong>
            </span>
            <span className="sep">·</span>
            <span>
              Simulateurs sous <strong>CC BY 4.0</strong>
            </span>
            <span className="sep">·</span>
            <span>
              <strong>Aucune</strong> transaction réelle
            </span>
          </div>
        </div>
        <div className="hero-visual">
          <div className="hero-glow" aria-hidden="true" />
          <ProductMock />
        </div>
      </section>

      <section className="s-section">
        <div className="container">
          <h2 className="s-title">
            Une plateforme complète. <span className="dim">Pour tester chaque intégration avant vos clients.</span>
          </h2>
          <div className="bento-grid">
            <Bento
              icon="grid"
              title="Catalogue de simulateurs"
              className="span-2 tall"
              visual={<CatalogueArt />}
            >
              Chaque simulateur est <b>un fichier YAML validé</b>, documenté automatiquement et <b>forkable</b> par la communauté.
            </Bento>
            <Bento
              icon="key"
              title="Clés de test"
              visual={<KeysArt />}
            >
              <b>Hachées en SHA-256</b>, affichées <b>une seule fois</b>, révocables à tout moment.
            </Bento>
            <Bento
              icon="zap"
              title="Scénarios d'échec"
              visual={<ScenarioArt />}
            >
              Solde insuffisant, délai dépassé : activez un scénario <b>sans toucher au code</b> de votre app.
            </Bento>
            <Bento
              icon="terminal"
              title="Console"
              visual={<ConsoleArt />}
            >
              Chaque appel journalisé : <b>statut, durée, scénario</b>, filtres et détail.
            </Bento>
            <Bento
              icon="code"
              title="Éditeur YAML"
              visual={<EditorArt />}
            >
              Monaco et <b>validation en direct</b> par le même schéma que le moteur.
            </Bento>
            <Bento
              icon="sparkles"
              title="Assistant IA"
              className="span-2"
              visual={<AiArt />}
            >
              Décrivez un service en français : <b>le YAML est généré, validé par le schéma</b> et marqué « Généré par IA, à vérifier ».
            </Bento>
            <Bento
              icon="shield"
              title="Sécurisé par défaut"
              className="span-2"
              visual={<SecurityArt />}
            >
              Les journaux ne gardent que des <b>métadonnées</b>. Les secrets ne quittent jamais le serveur en clair.
            </Bento>
          </div>
        </div>
      </section>

      <section className="s-section">
        <div className="container">
          <h2 className="s-title">
            Votre premier test <span className="dim">en moins de 5 minutes.</span>
          </h2>
          <div className="steps-grid">
            {[
              ["01", "Créez un projet et une clé", "Un projet regroupe vos clés de test, votre webhook et le journal de vos appels."],
              ["02", "Appelez un simulateur", "Votre app envoie ses requêtes à sim.hifrica.site avec sa clé sk_test_…."],
              ["03", "Jouez les échecs", "Activez « solde insuffisant » dans la console et vérifiez que votre app le gère."],
            ].map(([n, t, d]) => (
              <div key={n} className="bento step">
                <span className="step-n">{n}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="container">
          <h2>
            Testez votre intégration <span className="muted">dès aujourd'hui.</span>
          </h2>
          <div className="hero-cta">
            <Link to={start} className="pill pill-primary">
              {user ? "Ouvrir le tableau de bord" : "Démarrer gratuitement"}
            </Link>
            <Link to="/catalogue" className="pill pill-ghost">
              Voir le catalogue
            </Link>
          </div>
        </div>
      </section>

      <footer className="site-foot">
        <div className="container foot-grid">
          <div>
            <Link to="/" className="brand" style={{ padding: 0, marginBottom: "0.9rem" }}>
              <Logo /> Hifrica
            </Link>
            <p>Simulateurs de paiement mobile, d'USSD et de SMS pour tester les apps africaines. Aucune transaction réelle.</p>
          </div>
          <div>
            <h4>Produit</h4>
            <Link to="/catalogue">Catalogue</Link>
            <Link to="/editeur">Éditeur YAML</Link>
            <Link to={user ? "/demo" : "/inscription"}>Boutique démo</Link>
          </div>
          <div>
            <h4>Compte</h4>
            <Link to="/inscription">Créer un compte</Link>
            <Link to="/connexion">Se connecter</Link>
            {user && <Link to="/app">Tableau de bord</Link>}
          </div>
          <div>
            <h4>Projet</h4>
            <p>CADEV 2026</p>
            <p>Simulateurs sous CC BY 4.0</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
