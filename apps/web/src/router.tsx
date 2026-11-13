// Routeur minimal (History API) : évite une dépendance pour une dizaine de routes.
import { createContext, useCallback, useContext, useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from "react";

interface RouterState {
  path: string;
  search: URLSearchParams;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterState | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(() => ({ path: window.location.pathname, search: window.location.search }));

  useEffect(() => {
    const onPop = () => setLocation({ path: window.location.pathname, search: window.location.search });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
    const url = new URL(to, window.location.origin);
    setLocation({ path: url.pathname, search: url.search });
    window.scrollTo(0, 0);
  }, []);

  return (
    <RouterContext.Provider value={{ path: location.path, search: new URLSearchParams(location.search), navigate }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter(): RouterState {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("RouterProvider manquant");
  return ctx;
}

/** Associe un chemin à un motif (/app/projects/:id) ; renvoie les paramètres ou null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Link({ to, children, className, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate, path } = useRouter();
  const active = to === path || (to !== "/" && path.startsWith(to + "/"));
  return (
    <a
      href={to}
      className={[className, active ? "active" : ""].filter(Boolean).join(" ") || undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
