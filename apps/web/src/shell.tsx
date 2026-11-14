// Coquille de l'application, calquée sur le tableau de bord Supabase (apps/studio) :
// - en-tête pleine largeur : logo, fil d'Ariane avec sélecteur de projet, statut, menu du compte (avatar) ;
// - sous l'en-tête, barre latérale : rail d'icônes de 48 px ou panneau de 208 px, groupes séparés par un trait ;
// - en pied de barre, « Contrôle de la barre latérale » à trois modes, comme Supabase : Déployée (le contenu
//   est décalé, rien n'est masqué), Réduite (icônes seules), Déployée au survol (le panneau passe au-dessus
//   du contenu). Mode mémorisé dans le navigateur ; défaut : Déployée, pour ne jamais masquer le contenu.
// En mobile (≤ 960 px), la navigation devient un tiroir complet ouvert depuis l'en-tête.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useRouter } from "./router.js";
import { useProjects } from "./projects.js";
import { useSession } from "./session.js";
import { Icon, type IconName } from "./ui.js";

interface NavEntry {
  to: string;
  label: string;
  icon: IconName;
  needsProject?: boolean;
  auth?: boolean;
}

// Groupes sans titre, séparés par un trait (comme Supabase) ; le nom sert de libellé accessible.
const NAV: { title: string; items: NavEntry[] }[] = [
  {
    title: "Projet",
    items: [
      { to: "/app", label: "Vue d'ensemble", icon: "home", auth: true },
      { to: "/app/projets", label: "Projets", icon: "folder", auth: true },
      { to: "/app/cles", label: "Clés API", icon: "key", auth: true, needsProject: true },
      { to: "/app/console", label: "Console", icon: "terminal", auth: true, needsProject: true },
      { to: "/app/simulateurs", label: "Simulateurs", icon: "layers", auth: true, needsProject: true },
    ],
  },
  {
    title: "Plateforme",
    items: [
      { to: "/catalogue", label: "Catalogue", icon: "grid" },
      { to: "/editeur", label: "Éditeur YAML", icon: "code" },
      { to: "/demo", label: "Boutique démo", icon: "cart", auth: true },
    ],
  },
  {
    title: "Configuration",
    items: [{ to: "/app/parametres", label: "Paramètres", icon: "settings", auth: true, needsProject: true }],
  },
];

export type SidebarMode = "open" | "closed" | "expandable";
const SIDEBAR_KEY = "hifrica:sidebar";
const SIDEBAR_MODES: { value: SidebarMode; label: string }[] = [
  { value: "open", label: "Déployée" },
  { value: "closed", label: "Réduite" },
  { value: "expandable", label: "Déployée au survol" },
];

function readSidebarMode(): SidebarMode {
  try {
    const v = localStorage.getItem(SIDEBAR_KEY);
    if (v === "open" || v === "closed" || v === "expandable") return v;
  } catch {
    /* stockage indisponible (navigation privée...) : mode par défaut */
  }
  return "open";
}

export function Logo() {
  return (
    // Logo officiel de l'équipe (docs/logo.png, fond rendu transparent et recadré en carré : public/logo.png).
    <img className="logo" src="/logo.png" alt="" width={26} height={26} decoding="async" draggable={false} />
  );
}

function isActive(to: string, path: string) {
  if (to === "/app") return path === "/app";
  return path === to || path.startsWith(to + "/");
}

/** Menu déroulant léger (bouton + liste) : fermeture par Échap, clic extérieur ou navigation. */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      ref.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Focus sur l'élément coché (ou le premier) à l'ouverture, pour le clavier.
    ref.current?.querySelector<HTMLElement>('[role="menu"] [aria-checked="true"], [role="menu"] [role^="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

export interface Crumb {
  label: string;
  to?: string;
}

export function AppShell({ children, crumbs, actions, full }: { children: ReactNode; crumbs: Crumb[]; actions?: ReactNode; full?: boolean }) {
  const { user, signOut } = useSession();
  const { projects, active, select } = useProjects();
  const { path, navigate } = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [online, setOnline] = useState(true);
  const [mode, setMode] = useState<SidebarMode>(readSidebarMode);
  const control = useDropdown();
  const account = useDropdown();

  useEffect(() => {
    setDrawer(false);
    control.setOpen(false);
    account.setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  function chooseMode(next: SidebarMode) {
    setMode(next);
    control.setOpen(false);
    try {
      localStorage.setItem(SIDEBAR_KEY, next);
    } catch {
      /* préférence non mémorisée : sans conséquence */
    }
  }

  // Statut de connexion réel : santé de l'API toutes les 30 s.
  useEffect(() => {
    let alive = true;
    const check = () =>
      fetch("/api/health")
        .then((r) => alive && setOnline(r.ok))
        .catch(() => alive && setOnline(false));
    void check();
    const t = setInterval(check, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Libellé en infobulle seulement quand le texte n'est pas affiché en permanence (rail d'icônes).
  const tip = (label: string) => (mode === "open" ? undefined : label);

  return (
    <div className="app" data-sidebar={mode}>
      <header className="topbar">
        <button className="btn btn-ghost btn-icon menu-btn" aria-label="Ouvrir la navigation" onClick={() => setDrawer(true)}>
          <Icon name="menu" />
        </button>
        <Link to={user ? "/app" : "/"} className="top-brand" aria-label={user ? "Hifrica, tableau de bord" : "Hifrica, accueil"}>
          <Logo />
        </Link>
        <nav className="crumbs" aria-label="Fil d'Ariane">
          {crumbs.map((c, i) => (
            <span key={i} className="row-nw" style={{ gap: "0.4rem", minWidth: 0 }}>
              <span className="sep" aria-hidden="true">/</span>
              {i === 0 && user && active && projects && projects.length > 0 && c.label === active.name ? (
                // Le projet du fil d'Ariane devient le sélecteur de projet (comme l'organisation/le projet de Supabase).
                <span className="crumb-switch">
                  <label className="sr-only" htmlFor="project-switch">
                    Projet actif
                  </label>
                  <select id="project-switch" value={active.id} onChange={(e) => select(e.target.value)}>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <Icon name="chevronDown" />
                </span>
              ) : c.to && i < crumbs.length - 1 ? (
                <Link to={c.to} className="truncate">
                  {c.label}
                </Link>
              ) : (
                <span className={i === crumbs.length - 1 ? "current truncate" : "truncate"}>{c.label}</span>
              )}
            </span>
          ))}
        </nav>
        <span className={online ? "conn hide-xs" : "conn down hide-xs"} title={online ? "API en ligne" : "API injoignable"}>
          <span className="dot" /> {online ? "En ligne" : "Hors ligne"}
        </span>
        {actions}
        {user ? (
          <div className="dropdown" ref={account.ref}>
            <button
              className="avatar-btn"
              aria-haspopup="menu"
              aria-expanded={account.open}
              aria-label={`Compte de ${user.name}`}
              onClick={() => account.setOpen((v) => !v)}
            >
              <span className="avatar">{user.name.slice(0, 2)}</span>
            </button>
            {account.open && (
              <div className="menu menu-right" role="menu" aria-label="Compte">
                <div className="menu-head">
                  <div className="truncate" style={{ fontSize: "0.84rem", fontWeight: 500, color: "var(--text)" }}>
                    {user.name}
                  </div>
                  <div className="truncate xs muted">{user.email}</div>
                </div>
                <div className="menu-sep" role="separator" />
                <button
                  role="menuitem"
                  className="menu-item"
                  onClick={async () => {
                    account.setOpen(false);
                    await signOut();
                    navigate("/");
                  }}
                >
                  <Icon name="logout" /> Se déconnecter
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="row-nw" style={{ gap: "0.4rem" }}>
            <Link to="/connexion" className="btn btn-sm hide-xs">
              Se connecter
            </Link>
            <Link to="/inscription" className="btn btn-primary btn-sm">
              Créer un compte
            </Link>
          </div>
        )}
      </header>

      <div className="app-body">
        {drawer && <div className="drawer-overlay" style={{ zIndex: 55 }} onClick={() => setDrawer(false)} />}
        <div className="sidebar-slot">
          <aside className={drawer ? "sidebar open" : "sidebar"} aria-label="Navigation">
            <nav className="sidebar-nav">
              {NAV.map((group) => {
                const items = group.items.filter((i) => !i.auth || user);
                if (items.length === 0) return null;
                return (
                  <div className="nav-group" key={group.title} role="group" aria-label={group.title}>
                    {items.map((item) => {
                      const disabled = item.needsProject && !active;
                      const current = isActive(item.to, path);
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          className={["nav-item", current ? "active" : "", disabled ? "disabled" : ""].filter(Boolean).join(" ")}
                          aria-current={current ? "page" : undefined}
                          aria-disabled={disabled || undefined}
                          title={disabled ? "Créez d'abord un projet" : tip(item.label)}
                        >
                          <Icon name={item.icon} /> <span className="rail-text">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </nav>
            <div className="sidebar-foot">
              {/* Retour au site public : la page d'accueil de l'application (route « / »). */}
              <Link to="/" className="nav-item" aria-label="Site public (page d'accueil)" title={tip("Site public")}>
                <Icon name="globe" /> <span className="rail-text">Site public</span>
              </Link>
              <div className="dropdown sidebar-control" ref={control.ref}>
                <button
                  className="nav-item"
                  aria-haspopup="menu"
                  aria-expanded={control.open}
                  aria-label="Contrôle de la barre latérale"
                  title={tip("Contrôle de la barre latérale")}
                  onClick={() => control.setOpen((v) => !v)}
                >
                  <Icon name="panel" />
                </button>
                {control.open && (
                  <div className="menu menu-up" role="menu" aria-label="Contrôle de la barre latérale">
                    <div className="menu-label">Barre latérale</div>
                    <div className="menu-sep" role="separator" />
                    {SIDEBAR_MODES.map((m) => (
                      <button key={m.value} role="menuitemradio" aria-checked={mode === m.value} className="menu-item" onClick={() => chooseMode(m.value)}>
                        <span className="menu-check" aria-hidden="true">{mode === m.value && <Icon name="check" />}</span>
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
        <main className={full ? "content full" : "content"}>{children}</main>
      </div>
    </div>
  );
}

/** En-tête de page standard. */
export function PageHead({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
