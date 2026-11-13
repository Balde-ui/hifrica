import { StrictMode, Suspense, lazy, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/sora";
import "./styles.css";
import { RouterProvider, match, useRouter } from "./router.js";
import { SessionProvider, useSession } from "./session.js";
import { ProjectsProvider, useProjects } from "./projects.js";
import { AppShell } from "./shell.js";
import { Empty, Skeleton, ToastProvider } from "./ui.js";
import { Link } from "./router.js";
import { Landing } from "./pages/Landing.js";
import { AuthPage } from "./pages/Auth.js";
import { Overview } from "./pages/Overview.js";
import { ProjectsPage } from "./pages/Projects.js";
import { KeysPage } from "./pages/Keys.js";
import { ConsolePage } from "./pages/Console.js";
import { SimulatorsPage } from "./pages/Simulators.js";
import { SettingsPage } from "./pages/Settings.js";
import { CatalogPage } from "./pages/Catalog.js";
import { SimulatorPage } from "./pages/Simulator.js";
import { DemoShop } from "./pages/Demo.js";

// L'éditeur (Monaco) n'est chargé qu'à l'ouverture de la page.
const EditorPage = lazy(() => import("./pages/Editor.js").then((m) => ({ default: m.EditorPage })));

function PageSkeleton() {
  return (
    <div className="stack" role="status" aria-label="Chargement">
      <Skeleton h={26} w={260} />
      <Skeleton h={14} w={420} />
      <div className="grid cols-4" style={{ marginTop: "1.5rem" }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} h={96} />
        ))}
      </div>
      <Skeleton h={260} />
    </div>
  );
}

/** Pages réservées aux utilisateurs connectés : redirection vers la connexion sinon. */
function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const { navigate, path } = useRouter();
  useEffect(() => {
    if (!loading && !user) navigate(`/connexion?suite=${encodeURIComponent(path)}`, { replace: true });
  }, [loading, user, navigate, path]);
  if (loading || !user) return <PageSkeleton />;
  return <>{children}</>;
}

/** Pages qui portent sur le projet actif : invitation à en créer un s'il n'y en a aucun. */
function NeedsProject({ children }: { children: ReactNode }) {
  const { projects, active } = useProjects();
  if (projects === null) return <PageSkeleton />;
  if (!active) {
    return (
      <div className="panel">
        <Empty icon="folder" title="Aucun projet" action={<Link to="/app/projets?nouveau=1" className="btn btn-primary">Créer un projet</Link>}>
          Un projet regroupe vos clés de test, votre webhook, vos scénarios et le journal de vos appels.
        </Empty>
      </div>
    );
  }
  return <>{children}</>;
}

function Routes() {
  const { path, navigate } = useRouter();
  const { active, select } = useProjects();
  const project = active ? { label: active.name, to: "/app" } : { label: "Projet" };
  let params: Record<string, string> | null;

  // Anciennes adresses de projet : on sélectionne le projet puis on ouvre sa vue d'ensemble.
  useEffect(() => {
    const m = match("/app/projets/:id", path);
    if (m) {
      select(m.id);
      navigate("/app", { replace: true });
    }
  }, [path, select, navigate]);

  if (path === "/") return <Landing />;
  if (path === "/connexion") return <AuthPage mode="login" />;
  if (path === "/inscription") return <AuthPage mode="signup" />;

  const app = (crumbs: { label: string; to?: string }[], node: ReactNode, opts: { full?: boolean } = {}) => (
    <AppShell crumbs={crumbs} full={opts.full}>
      {node}
    </AppShell>
  );

  if (path === "/app") return app([project, { label: "Vue d'ensemble" }], <Protected><Overview /></Protected>);
  if (path === "/app/projets") return app([{ label: "Projets" }], <Protected><ProjectsPage /></Protected>);
  if (path === "/app/cles") return app([project, { label: "Clés API" }], <Protected><NeedsProject><KeysPage /></NeedsProject></Protected>);
  if (path === "/app/console") return app([project, { label: "Console" }], <Protected><NeedsProject><ConsolePage /></NeedsProject></Protected>);
  if (path === "/app/simulateurs") return app([project, { label: "Simulateurs" }], <Protected><NeedsProject><SimulatorsPage /></NeedsProject></Protected>);
  if (path === "/app/parametres") return app([project, { label: "Paramètres" }], <Protected><NeedsProject><SettingsPage /></NeedsProject></Protected>);
  if (match("/app/projets/:id", path)) return app([{ label: "Projets" }], <PageSkeleton />);
  if (path === "/catalogue") return app([{ label: "Catalogue" }], <CatalogPage />);
  if ((params = match("/catalogue/:slug", path))) {
    return app([{ label: "Catalogue", to: "/catalogue" }, { label: params.slug }], <SimulatorPage slug={params.slug} />);
  }
  if (path === "/editeur") {
    return app(
      [{ label: "Éditeur YAML" }],
      <Suspense fallback={<PageSkeleton />}>
        <EditorPage />
      </Suspense>,
      { full: true },
    );
  }
  if (path === "/demo") return app([project, { label: "Boutique démo" }], <Protected><DemoShop /></Protected>);
  return app(
    [{ label: "Page introuvable" }],
    <div className="panel">
      <Empty icon="alert" title="Page introuvable" action={<Link to="/" className="btn">Retour à l'accueil</Link>}>
        L'adresse demandée n'existe pas.
      </Empty>
    </div>,
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider>
      <SessionProvider>
        <ProjectsProvider>
          <ToastProvider>
            <Routes />
          </ToastProvider>
        </ProjectsProvider>
      </SessionProvider>
    </RouterProvider>
  </StrictMode>,
);
