// Accueil : héros inspiré de prisma.io (cadre, titre centré, puces, boutons pilule, maquette produit),
// reste de la page inspiré de supabase.com (navigation, grille « bento », titres bicolores, pied de page).
// Contenu propre à Hifrica ; aucune statistique inventée.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "../router.js";
import { useSession } from "../session.js";
import { Logo } from "../shell.js";
import { Icon, type IconName } from "../ui.js";
import { AiArt, CatalogueArt, ConsoleArt, EditorArt, KeysArt, ScenarioArt, SecurityArt } from "./landingArt.js";

/**
 * Navigation publique, reprise du comportement de prisma.io : en-tête collant de hauteur nulle (il se
 * superpose au héros, aucun saut de mise en page). En haut de page, barre pleine largeur transparente ;
 * au défilement, la même barre se resserre en capsule flottante floutée (896 px, 56 px de haut, à 12 px
 * du haut). Le contenu garde la même position : seul le fond change. Menu « Plateforme » déroulant ;
 * en mobile, tiroir latéral à droite.
 */
const PLATFORM: { to: string; icon: IconName; title: string; text: string; auth?: boolean }[] = [
  { to: "/app/console", icon: "terminal", title: "Console", text: "Chaque requête de votre app, en direct", auth: true },
  { to: "/editeur", icon: "code", title: "Éditeur YAML", text: "Écrire, valider et publier un simulateur" },
  { to: "/demo", icon: "cart", title: "Boutique démo", text: "Une app marchande branchée sur Hifrica", auth: true },
];

function SiteNav() {
  const { user } = useSession();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drawerClose = useRef<HTMLButtonElement>(null);
  const href = (to: string, auth?: boolean) => (auth && !user ? `/inscription?suite=${encodeURIComponent(to)}` : to);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
      setMenu(false); // le menu « Plateforme » se referme dès que la page défile
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Tiroir mobile : Échap ferme, défilement de la page bloqué, focus sur le bouton de fermeture.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const wide = window.matchMedia("(min-width: 900px)");
    const onWide = () => wide.matches && setOpen(false);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawerClose.current?.focus();
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const openMenu = () => {
    clearTimeout(closeTimer.current);
    setMenu(true);
  };
  const closeMenu = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMenu(false), 120);
  };

  return (
    <>
      <header className="pn-header">
        <div className={`pn-bar${scrolled ? " is-scrolled" : ""}`}>
          <div className="pn-inner">
            <Link to="/" className="pn-brand" aria-label="Hifrica, accueil">
              <Logo /> Hifrica
            </Link>
            <nav className="pn-links" aria-label="Navigation">
              <div
                className="pn-dd"
                onMouseEnter={openMenu}
                onMouseLeave={closeMenu}
                onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && closeMenu()}
                onKeyDown={(e) => e.key === "Escape" && setMenu(false)}
              >
                <button type="button" className="pn-link pn-dd-trigger" aria-expanded={menu} aria-controls="pn-platform" onClick={() => setMenu((v) => !v)}>
                  Plateforme <Icon name="chevronDown" size={14} />
                </button>
                <div id="pn-platform" className={`pn-dd-panel${menu ? " is-open" : ""}`} onClickCapture={() => setMenu(false)}>
                  {PLATFORM.map((item) => (
                    <Link key={item.title} to={href(item.to, item.auth)} className="pn-dd-item" tabIndex={menu ? 0 : -1}>
                      <span className="pn-dd-icon">
                        <Icon name={item.icon} size={14} />
                      </span>
                      <span>
                        <span className="pn-dd-title">{item.title}</span>
                        <span className="pn-dd-text">{item.text}</span>
                      </span>
                    </Link>
                  ))}
                  <div className="pn-dd-sep" />
                  <Link to="/catalogue" className="pn-dd-more" tabIndex={menu ? 0 : -1}>
                    Parcourir le catalogue <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </div>
              <Link to="/catalogue" className="pn-link">
                Catalogue
              </Link>
              <a href={README} className="pn-link" target="_blank" rel="noreferrer">
                Documentation
              </a>
              <a href={REPO} className="pn-link" target="_blank" rel="noreferrer">
                GitHub
              </a>
            </nav>
            <div className="pn-actions">
              {user ? (
                <Link to="/app" className="pn-pill pn-pill-solid">
                  Tableau de bord
                </Link>
              ) : (
                <>
                  <Link to="/connexion" className="pn-pill pn-pill-ghost">
                    Se connecter
                  </Link>
                  <Link to="/inscription" className="pn-pill pn-pill-solid">
                    Commencer
                  </Link>
                </>
              )}
              <button type="button" className="pn-burger" aria-expanded={open} aria-controls="pn-drawer" aria-label="Ouvrir le menu" onClick={() => setOpen(true)}>
                <Icon name="menu" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className={`pn-overlay${open ? " is-open" : ""}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside id="pn-drawer" className={`pn-drawer${open ? " is-open" : ""}`} aria-label="Menu" aria-hidden={!open} inert={!open ? true : undefined}>
        <button ref={drawerClose} type="button" className="pn-drawer-close" aria-label="Fermer le menu" onClick={() => setOpen(false)}>
          <Icon name="x" size={14} />
        </button>
        <nav onClickCapture={() => setOpen(false)}>
          <p className="pn-drawer-label">Plateforme</p>
          {PLATFORM.map((item) => (
            <Link key={item.title} to={href(item.to, item.auth)} className="pn-drawer-link">
              {item.title}
            </Link>
          ))}
          <div className="pn-drawer-sep" />
          <Link to="/catalogue" className="pn-drawer-link">
            Catalogue
          </Link>
          <a href={README} className="pn-drawer-link" target="_blank" rel="noreferrer">
            Documentation
          </a>
          <a href={REPO} className="pn-drawer-link" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <div className="pn-drawer-sep" />
          <div className="pn-drawer-actions">
            {user ? (
              <Link to="/app" className="pn-pill pn-pill-solid">
                Tableau de bord
              </Link>
            ) : (
              <>
                <Link to="/connexion" className="pn-pill pn-pill-outline">
                  Se connecter
                </Link>
                <Link to="/inscription" className="pn-pill pn-pill-solid">
                  Commencer
                </Link>
              </>
            )}
          </div>
        </nav>
      </aside>
    </>
  );
}

/** Dépôt public du projet (évaluation CADEV) et son README, seules sources de documentation existantes. */
const REPO = "https://github.com/Balde-ui/hifrica";
const README = `${REPO}/blob/main/README.md`;

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
      <SiteNav />
      <section className="hero-frame">
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
                ["#f43f5e", "Gratuit pour les développeurs"],
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

      <footer className="pf">
        <div className="pf-inner">
          <div className="pf-brand">
            <Link to="/" className="pn-brand" aria-label="Hifrica, accueil">
              <Logo /> Hifrica
            </Link>
            <a href={REPO} className="pf-contact" target="_blank" rel="noreferrer">
              <Icon name="git" size={15} /> github.com/Balde-ui/hifrica
            </a>
            <a href={README} className="pf-contact" target="_blank" rel="noreferrer">
              <Icon name="book" size={15} /> Documentation du projet
            </a>
            <p className="pf-copy">© 2026 Équipe Hifrica. Tous droits réservés.</p>
          </div>
          <div className="pf-cols">
            <div>
              <h3>Plateforme</h3>
              <Link to="/catalogue">Catalogue</Link>
              <Link to="/editeur">Éditeur YAML</Link>
              <Link to={user ? "/demo" : "/inscription"}>Boutique démo</Link>
              <Link to={user ? "/app/console" : "/inscription"}>Console</Link>
              <Link to={user ? "/app/cles" : "/inscription"}>Clés API</Link>
            </div>
            <div>
              <h3>Documentation</h3>
              <a href={`${README}#démarrage-en-5-minutes`} target="_blank" rel="noreferrer">Démarrage en 5 minutes</a>
              <a href={`${README}#écrire-son-simulateur`} target="_blank" rel="noreferrer">Écrire un simulateur</a>
              <a href={`${README}#simulateur-ussd`} target="_blank" rel="noreferrer">Simulateur USSD</a>
              <a href={`${README}#webhooks`} target="_blank" rel="noreferrer">Webhooks</a>
              <a href={`${README}#architecture`} target="_blank" rel="noreferrer">Architecture</a>
            </div>
            <div>
              <h3>Développeurs</h3>
              {user ? <Link to="/app">Tableau de bord</Link> : <Link to="/inscription">Créer un compte</Link>}
              {!user && <Link to="/connexion">Se connecter</Link>}
              <a href={`${README}#vérifier-la-signature-nodejs`} target="_blank" rel="noreferrer">Vérifier une signature</a>
              <a href={`${README}#développement-local`} target="_blank" rel="noreferrer">Développement local</a>
            </div>
            <div>
              <h3>Licences</h3>
              <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">Licence du code</a>
              <a href="https://creativecommons.org/licenses/by/4.0/deed.fr" target="_blank" rel="noreferrer">Simulateurs : CC BY 4.0</a>
              <a href={`${REPO}/blob/main/LICENSES.md`} target="_blank" rel="noreferrer">Licences des dépendances</a>
              <a href={`${REPO}/blob/main/AI_USAGE.md`} target="_blank" rel="noreferrer">Usage de l'IA</a>
            </div>
            <div>
              <h3>Code source</h3>
              <a href={REPO} className="pf-social" target="_blank" rel="noreferrer">
                <Icon name="git" size={14} /> GitHub
              </a>
            </div>
          </div>
        </div>
        <div className="pf-word" aria-hidden="true">
          Hifrica
        </div>
      </footer>
    </div>
  );
}
