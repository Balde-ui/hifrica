// Composants d'interface partagés.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function Loading({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function Alert({ kind = "err", children }: { kind?: "err" | "warn" | "ok" | "info"; children: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === "err" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function StatusCode({ status }: { status: number | null }) {
  if (status === null) return <span className="status muted">—</span>;
  return <span className={`status status-${String(status)[0]}`}>{status}</span>;
}

export function SimulatorBadges({ status, origin }: { status: string; origin: string }) {
  return (
    <span className="row" style={{ gap: "0.3rem" }}>
      {status === "verified" && <span className="badge badge-ok">✓ Vérifié</span>}
      {origin === "ai" && <span className="badge badge-warn">Généré par IA, à vérifier</span>}
      {status === "draft" && <span className="badge">Communauté</span>}
    </span>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="spread" style={{ marginBottom: "0.75rem" }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn btn-sm" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---- Notifications éphémères ----
const ToastContext = createContext<(message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const push = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-zone" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function CopyButton({ value, label = "Copier", className = "btn btn-sm" }: { value: string; label?: string; className?: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        navigator.clipboard
          .writeText(value)
          .then(() => toast("Copié dans le presse-papiers"))
          .catch(() => toast("Copie impossible : sélectionnez le texte"));
      }}
    >
      {label}
    </button>
  );
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <div className="codeblock">
      <div className="copy">
        <CopyButton value={code} />
      </div>
      <pre>{code}</pre>
    </div>
  );
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" });
}
