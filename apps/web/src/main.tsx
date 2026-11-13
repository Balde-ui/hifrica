import { StrictMode, Suspense, lazy, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { Link, RouterProvider, match, useRouter } from "./router.js";
import { SessionProvider, useSession } from "./session.js";
import { Loading, ToastProvider } from "./ui.js";
import { Landing } from "./pages/Landing.js";
import { AuthPage } from "./pages/Auth.js";
import { Dashboard } from "./pages/Dashboard.js";
import { ProjectPage } from "./pages/Project.js";
import { CatalogPage } from "./pages/Catalog.js";
import { SimulatorPage } from "./pages/Simulator.js";
import { DemoShop } from "./pages/Demo.js";

// L'éditeur (Monaco, plusieurs centaines de Ko) n'est chargé qu'à l'ouverture de la page.
const EditorPage = lazy(() => import("./pages/Editor.js").then((m) => ({ default: m.EditorPage })));

function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { user, signOut } = useSession();
  const { navigate } = useRouter();
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">H</span> Hifrica
        </Link>
        <nav className="nav" aria-label="Navigation principale">
          {user && <Link to="/app">Projets</Link>}
          <Link to="/catalogue">Catalogue</Link>
          <Link to="/editeur">Éditeur</Link>
          <Link to="/demo">Démo boutique</Link>
        </nav>
        <div className="userbox">
          {user ? (
            <>
              <span title={user.email}>{user.name}</span>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  await signOut();
                  navigate("/");
                }}
              >
                Se déconnecter
              </button>
            </>
          ) : (
            <>
              <Link to="/connexion" className="btn btn-sm">
                Se connecter
              </Link>
              <Link to="/inscription" className="btn btn-sm btn-primary">
                Créer un compte
              </Link>
            </>
          )}
        </div>
      </header>
      <main className={wide ? "main wide" : "main"}>{children}</main>
      <footer className="footer">
        Hifrica — simulateurs de test, aucune transaction réelle. Simulateurs communautaires sous licence CC BY 4.0.
      </footer>
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
  if (loading || !user) return <Loading />;
  return <>{children}</>;
}

function Routes() {
  const { path } = useRouter();
  let params: Record<string, string> | null;

  if (path === "/") return <Shell><Landing /></Shell>;
  if (path === "/connexion") return <Shell><AuthPage mode="login" /></Shell>;
  if (path === "/inscription") return <Shell><AuthPage mode="signup" /></Shell>;
  if (path === "/app") return <Shell><Protected><Dashboard /></Protected></Shell>;
  if ((params = match("/app/projets/:id", path))) {
    return <Shell><Protected><ProjectPage id={params.id} /></Protected></Shell>;
  }
  if (path === "/catalogue") return <Shell><CatalogPage /></Shell>;
  if ((params = match("/catalogue/:slug", path))) return <Shell><SimulatorPage slug={params.slug} /></Shell>;
  if (path === "/editeur") {
    return (
      <Shell wide>
        <Suspense fallback={<Loading label="Chargement de l'éditeur…" />}>
          <EditorPage />
        </Suspense>
      </Shell>
    );
  }
  if (path === "/demo") return <Shell><DemoShop /></Shell>;
  return (
    <Shell>
      <div className="empty">
        <h3>Page introuvable</h3>
        <p>
          <Link to="/">Retour à l'accueil</Link>
        </p>
      </div>
    </Shell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider>
      <SessionProvider>
        <ToastProvider>
          <Routes />
        </ToastProvider>
      </SessionProvider>
    </RouterProvider>
  </StrictMode>,
);
