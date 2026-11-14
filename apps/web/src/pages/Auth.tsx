// Connexion et inscription, mise en page façon supabase.com : formulaire à gauche, panneau à droite.
import { useEffect, useState, type FormEvent } from "react";
import { errorMessage } from "../api.js";
import { Link, useRouter } from "../router.js";
import { useSession } from "../session.js";
import { Logo } from "../shell.js";
import { Alert, Icon, Spinner } from "../ui.js";

const AUTH_ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Email ou mot de passe incorrect.",
  USER_ALREADY_EXISTS: "Un compte existe déjà avec cet email : connectez-vous.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Un compte existe déjà avec cet email : connectez-vous.",
  PASSWORD_TOO_SHORT: "Mot de passe trop court (8 caractères au moins).",
  PASSWORD_TOO_LONG: "Mot de passe trop long (128 caractères au plus).",
  INVALID_EMAIL: "Adresse email invalide.",
  NAME_REQUIRED: "Nom requis.",
  NAME_TOO_LONG: "Nom trop long (80 caractères au plus).",
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
  const [show, setShow] = useState(false);
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
    <div className="auth">
      <main className="auth-main">
        <Link to="/" className="brand">
          <Logo /> Hifrica
        </Link>
        <div className="auth-center">
          <div className="auth-card">
            <h1>{mode === "signup" ? "Créer un compte" : "Bon retour"}</h1>
            <p className="muted" style={{ marginTop: "0.35rem", marginBottom: "1.75rem" }}>
              {mode === "signup" ? "Gratuit, sans compte marchand ni carte bancaire." : "Connectez-vous à votre compte"}
            </p>
            {config?.github && (
              <>
                <button className="btn btn-block btn-lg" onClick={() => signInGithub().catch((err) => setError(authError(err)))} disabled={busy}>
                  <Icon name="git" /> Continuer avec GitHub
                </button>
                <div className="divider">ou</div>
              </>
            )}
            <form className="stack" onSubmit={submit} noValidate>
              {mode === "signup" && (
                <div className="field">
                  <label className="label" htmlFor="name">
                    Nom
                  </label>
                  <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} placeholder="Aminata Diallo" />
                </div>
              )}
              <div className="field">
                <label className="label" htmlFor="email">
                  Email
                </label>
                <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="vous@exemple.com" required />
              </div>
              <div className="field">
                <label className="label" htmlFor="password">
                  Mot de passe
                </label>
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <input
                    id="password"
                    type={show ? "text" : "password"}
                    className="input"
                    style={{ paddingRight: "2.4rem" }}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    style={{ position: "absolute", right: 4 }}
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  >
                    <Icon name={show ? "eyeOff" : "eye"} />
                  </button>
                </div>
                {mode === "signup" && <span className="hint">8 caractères au moins.</span>}
              </div>
              {error && <Alert>{error}</Alert>}
              <button className="btn btn-primary btn-block btn-lg" disabled={busy || !email || !password}>
                {busy ? <Spinner /> : mode === "signup" ? "Créer mon compte" : "Se connecter"}
              </button>
            </form>
            <p className="small muted" style={{ marginTop: "1.5rem", textAlign: "center" }}>
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
        <p className="xs muted" style={{ textAlign: "center" }}>
          Aucune transaction réelle · Simulateurs sous CC BY 4.0
        </p>
      </main>
      <aside className="auth-side" aria-hidden="true">
        <div className="auth-quote stack">
          <span className="mock-kicker">
            <Icon name="zap" size={13} /> Pourquoi Hifrica
          </span>
          <p className="big">
            Testez le paiement mobile de votre app sans compte marchand, et vérifiez qu'elle gère un solde insuffisant avant votre démo.
          </p>
          <p className="muted small">Projet, clé de test, premier appel, scénario d'échec : moins de 5 minutes.</p>
          <div className="code" style={{ marginTop: "1.25rem" }}>
            <pre>
              <span className="muted">$</span> curl -X POST …/paiement-mobile-generique/v1/checkout{"\n"}
              <span style={{ color: "var(--warn)" }}>402</span> {"{ "}
              <span className="tok-key">"error"</span>: <span className="tok-str">"insufficient_funds"</span>
              {" }"}
            </pre>
          </div>
        </div>
      </aside>
    </div>
  );
}
