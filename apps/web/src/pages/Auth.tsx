import { useEffect, useState, type FormEvent } from "react";
import { errorMessage } from "../api.js";
import { Link, useRouter } from "../router.js";
import { useSession } from "../session.js";
import { Alert, Spinner } from "../ui.js";

const AUTH_ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Email ou mot de passe incorrect.",
  USER_ALREADY_EXISTS: "Un compte existe déjà avec cet email : connectez-vous.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Un compte existe déjà avec cet email : connectez-vous.",
  PASSWORD_TOO_SHORT: "Mot de passe trop court (8 caractères au moins).",
  PASSWORD_TOO_LONG: "Mot de passe trop long (128 caractères au plus).",
  INVALID_EMAIL: "Adresse email invalide.",
};

function authError(err: unknown): string {
  const code = (err as { code?: string }).code;
  return (code && AUTH_ERRORS[code]) || errorMessage(err);
}

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const { signIn, signUp, signInGithub, user, config } = useSession();
  const { navigate, search } = useRouter();
  const next = search.get("suite") ?? "/app";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) navigate(safeNext, { replace: true });
  }, [user, navigate, safeNext]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "signup" && password.length < 8) return setError("Mot de passe trop court (8 caractères au moins).");
    setBusy(true);
    try {
      if (mode === "signup") await signUp(name.trim() || email.split("@")[0], email.trim(), password);
      else await signIn(email.trim(), password);
    } catch (err) {
      setError(authError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>{mode === "signup" ? "Créer un compte" : "Se connecter"}</h1>
        <p className="muted">
          {mode === "signup" ? "Gratuit, sans compte marchand ni carte bancaire." : "Retrouvez vos projets et vos clés de test."}
        </p>
        <form className="stack" onSubmit={submit} noValidate>
          {mode === "signup" && (
            <div className="field">
              <label htmlFor="name">Nom</label>
              <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">Mot de passe</label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
            />
            {mode === "signup" && <span className="hint">8 caractères au moins.</span>}
          </div>
          {error && <Alert>{error}</Alert>}
          <button className="btn btn-primary btn-block btn-lg" disabled={busy || !email || !password}>
            {busy ? <Spinner /> : mode === "signup" ? "Créer mon compte" : "Se connecter"}
          </button>
        </form>
        {config?.github && (
          <>
            <div className="divider">ou</div>
            <button
              className="btn btn-block"
              onClick={() => signInGithub().catch((err) => setError(authError(err)))}
              disabled={busy}
            >
              Continuer avec GitHub
            </button>
          </>
        )}
        <p className="small muted" style={{ marginTop: "1rem", marginBottom: 0 }}>
          {mode === "signup" ? (
            <>
              Déjà inscrit ? <Link to={`/connexion?suite=${encodeURIComponent(safeNext)}`}>Se connecter</Link>
            </>
          ) : (
            <>
              Pas encore de compte ? <Link to={`/inscription?suite=${encodeURIComponent(safeNext)}`}>Créer un compte</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
