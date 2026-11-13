// Coquille de l'application : barre latérale (navigation, projet actif, profil) + barre supérieure.
import { useEffect, useState, type ReactNode } from "react";
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

export function Logo() {
  return (
    <span className="logo" aria-hidden="true">
      <Icon name="logo" />
    </span>
  );
}

function isActive(to: string, path: string) {
  if (to === "/app") return path === "/app";
  return path === to || path.startsWith(to + "/");
}

export interface Crumb {
  label: string;
  to?: string;
}

export function AppShell({ children, crumbs, actions, full }: { children: ReactNode; crumbs: Crumb[]; actions?: ReactNode; full?: boolean }) {
  const { user, signOut } = useSession();
  const { projects, active, select } = useProjects();
  const { path, navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => setOpen(false), [path]);

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

  return (
    <div className="app">
      {open && <div className="drawer-overlay" style={{ zIndex: 55 }} onClick={() => setOpen(false)} />}
      <aside className={open ? "sidebar open" : "sidebar"} aria-label="Navigation">
        <Link to={user ? "/app" : "/"} className="brand">
          <Logo /> Hifrica
        </Link>
        {user && projects && projects.length > 0 && (
          <div className="project-switch">
            <label className="sr-only" htmlFor="project-switch">
              Projet actif
            </label>
            <select id="project-switch" className="input" value={active?.id ?? ""} onChange={(e) => select(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <nav>
          {NAV.map((group) => {
            const items = group.items.filter((i) => !i.auth || user);
            if (items.length === 0) return null;
            return (
              <div className="nav-group" key={group.title}>
                <div className="nav-label">{group.title}</div>
                {items.map((item) => {
                  const disabled = item.needsProject && !active;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={["nav-item", isActive(item.to, path) ? "active" : "", disabled ? "disabled" : ""].filter(Boolean).join(" ")}
                      aria-current={isActive(item.to, path) ? "page" : undefined}
                      aria-disabled={disabled || undefined}
                      title={disabled ? "Créez d'abord un projet" : undefined}
                    >
                      <Icon name={item.icon} /> {item.label}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          {user ? (
            <div className="user-chip">
              <span className="avatar">{user.name.slice(0, 2)}</span>
              <div className="grow">
                <div className="truncate" style={{ fontSize: "0.84rem", fontWeight: 500 }}>
                  {user.name}
                </div>
                <div className="truncate xs muted">{user.email}</div>
              </div>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                title="Se déconnecter"
                aria-label="Se déconnecter"
                onClick={async () => {
                  await signOut();
                  navigate("/");
                }}
              >
                <Icon name="logout" />
              </button>
            </div>
          ) : (
            <div className="stack-sm">
              <Link to="/inscription" className="btn btn-primary btn-block">
                Créer un compte
              </Link>
              <Link to="/connexion" className="btn btn-block">
                Se connecter
              </Link>
            </div>
          )}
        </div>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon menu-btn" aria-label="Ouvrir la navigation" onClick={() => setOpen(true)}>
            <Icon name="menu" />
          </button>
          <nav className="crumbs" aria-label="Fil d'Ariane">
            {crumbs.map((c, i) => (
              <span key={i} className="row-nw" style={{ gap: "0.4rem", minWidth: 0 }}>
                {i > 0 && <span className="sep">/</span>}
                {c.to && i < crumbs.length - 1 ? (
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
        </header>
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
