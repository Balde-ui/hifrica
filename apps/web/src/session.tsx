// Session Better Auth réelle (cookie httpOnly) : aucune authentification simulée côté navigateur.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, forgetKeys, type AppConfig, type User } from "./api.js";

interface SessionState {
  user: User | null;
  loading: boolean;
  config: AppConfig | null;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signInGithub: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AppConfig | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await api<{ user: User }>("/api/me");
      setUser(me.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    api<AppConfig>("/api/config").then(setConfig).catch(() => setConfig(null));
  }, [refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await api("/api/auth/sign-in/email", { body: { email, password } });
      await refresh();
    },
    [refresh],
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      await api("/api/auth/sign-up/email", { body: { name, email, password } });
      await refresh();
    },
    [refresh],
  );

  const signInGithub = useCallback(async () => {
    const res = await api<{ url?: string }>("/api/auth/sign-in/social", {
      body: { provider: "github", callbackURL: `${window.location.origin}/app` },
    });
    if (res.url) window.location.assign(res.url);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api("/api/auth/sign-out", { body: {} });
    } finally {
      forgetKeys();
      setUser(null);
    }
  }, []);

  return (
    <SessionContext.Provider value={{ user, loading, config, refresh, signIn, signUp, signInGithub, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("SessionProvider manquant");
  return ctx;
}
