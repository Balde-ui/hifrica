// Composants d'interface partagés du design system Hifrica.
import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";

// ---------------------------------------------------------------------------------------------------
// Icônes (traits simples dessinés pour Hifrica, 24×24, stroke = currentColor)
// ---------------------------------------------------------------------------------------------------
const PATHS: Record<string, ReactNode> = {
  logo: <path d="M6 4v16M18 4v16M6 12h12" strokeWidth="2.6" />,
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
  folder: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3M15 8l2 2" /></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  code: <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />,
  cart: <><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2.5 3h2.6l2.4 12h11.2l2-8.5H6.2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2" /></>,
  logout: <><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" /><path d="m10 16-4-4 4-4M6 12h10" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  eyeOff: <><path d="M3 3l18 18" /><path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.4 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.1-1" /></>,
  send: <path d="M4 12 20 4l-4 16-4-6.5zM12 13.5 20 4" />,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  alert: <><path d="M12 3 2.5 20h19z" /><path d="M12 10v4.5M12 17.2v.3" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.8v.3" /></>,
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="m8 12.3 2.8 2.8L16.2 9.5" /></>,
  xCircle: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  sparkles: <><path d="m12 3 1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15v4M17 17h4" /></>,
  upload: <><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></>,
  file: <><path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" /><path d="M14 3v5h5" /></>,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5" /></>,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z" /><path d="m9 12 2 2 4-4" /></>,
  zap: <path d="M13 3 4.5 13.5H12L11 21l8.5-10.5H12z" />,
  git: <><circle cx="6" cy="6" r="2.2" /><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="8" r="2.2" /><path d="M6 8.2v7.6M18 10.2c0 4-6 3.3-11.2 6.3" /></>,
  phone: <><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M11 18.5h2" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.2-4 4.4-6 8-6s6.8 2 8 6" /></>,
  filter: <path d="M4 5h16l-6 7.5V19l-4 2v-8.5z" />,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z" /></>,
  panel: <><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M9 3v2.5M9 9.5v1.5M9 14.5V16M9 19v2" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------
// États
// ---------------------------------------------------------------------------------------------------
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function Skeleton({ h = 14, w = "100%", style }: { h?: number; w?: number | string; style?: CSSProperties }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ padding: "0.9rem 1rem" }} role="status" aria-label="Chargement">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="row-nw" style={{ gap: "1rem", padding: "0.55rem 0" }}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} h={12} w={c === 1 ? "40%" : `${14 + ((r + c) % 3) * 6}%`} />
          ))}
        </div>
      ))}
    </div>
  );
}

const ALERT_ICON = { err: "xCircle", warn: "alert", ok: "checkCircle", info: "info" } as const;

export function Alert({ kind = "err", children }: { kind?: "err" | "warn" | "ok" | "info"; children: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === "err" ? "alert" : "status"}>
      <Icon name={ALERT_ICON[kind]} />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ icon = "layers", title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function StatusCode({ status }: { status: number | null }) {
  if (status === null) return <span className="status-code s0">—</span>;
  return <span className={`status-code s${String(status)[0]}`}>{status}</span>;
}

export function Method({ method }: { method: string }) {
  return <span className={`method method-${method}`}>{method}</span>;
}

/**
 * « En ligne » : le moteur exécute ce simulateur (propriété `executable` de l'API). Indépendant du statut
 * de vérification : un simulateur communautaire ou généré par IA peut être en ligne sans être vérifié.
 */
export function OnlineBadge() {
  return (
    <span className="badge badge-ok" title="Exécuté par le moteur : appelable avec une clé de test">
      <span className="dot" /> En ligne
    </span>
  );
}

export function SimulatorBadges({ status, origin }: { status: string; origin: string }) {
  return (
    <span className="row" style={{ gap: "0.3rem" }}>
      {status === "verified" && (
        <span className="badge badge-ok">
          <Icon name="shield" size={12} /> Vérifié
        </span>
      )}
      {origin === "ai" && (
        <span className="badge badge-warn">
          <Icon name="sparkles" size={12} /> Généré par IA, à vérifier
        </span>
      )}
      {status === "draft" && <span className="badge">Communauté</span>}
      {status === "to_verify" && origin !== "ai" && <span className="badge badge-warn">À vérifier</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------
// Modale et tiroir
// ---------------------------------------------------------------------------------------------------
function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
}

export function Modal({
  title,
  description,
  children,
  footer,
  onClose,
  width,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  useEscape(onClose);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { maxWidth: width } : undefined}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Fermer">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, children, onClose, actions }: { title: ReactNode; children: ReactNode; onClose: () => void; actions?: ReactNode }) {
  useEscape(onClose);
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="row-nw grow">{title}</div>
          <div className="row-nw">
            {actions}
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Fermer">
              <Icon name="x" />
            </button>
          </div>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------------------------------
const ToastContext = createContext<(message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const push = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.filter((x) => x.message !== message), { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <Icon name="checkCircle" /> {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function CopyButton({ value, label, small = true, ghost = false }: { value: string; label?: string; small?: boolean; ghost?: boolean }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={["btn", small ? "btn-sm" : "", ghost ? "btn-ghost" : "", label ? "" : "btn-icon"].filter(Boolean).join(" ")}
      aria-label={label ?? "Copier"}
      title="Copier"
      onClick={() => {
        navigator.clipboard
          .writeText(value)
          .then(() => {
            setDone(true);
            toast("Copié dans le presse-papiers");
            setTimeout(() => setDone(false), 1500);
          })
          .catch(() => toast("Copie impossible : sélectionnez le texte"));
      }}
    >
      <Icon name={done ? "check" : "copy"} />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------------------------------
export function CodeBlock({ code, title }: { code: string; title?: string }) {
  return (
    <div className="code">
      {title ? (
        <div className="code-head">
          <span>{title}</span>
          <CopyButton value={code} ghost />
        </div>
      ) : (
        <div className="copy-float">
          <CopyButton value={code} ghost />
        </div>
      )}
      <pre>{code}</pre>
    </div>
  );
}

/** JSON formaté et coloré (aucune exécution : simple découpage du texte produit par JSON.stringify). */
export function JsonView({ value, title }: { value: unknown; title?: string }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "null";
  const parts: ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) {
      parts.push(<span key={i++} className={m[2] ? "tok-key" : "tok-str"}>{m[1]}</span>);
      if (m[2]) parts.push(<span key={i++} className="tok-punc">{m[2]}</span>);
    } else if (m[3]) parts.push(<span key={i++} className="tok-lit">{m[3]}</span>);
    else if (m[4]) parts.push(<span key={i++} className="tok-num">{m[4]}</span>);
    else if (m[5]) parts.push(<span key={i++} className="tok-punc">{m[5]}</span>);
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <div className="code">
      <div className="code-head">
        <span>{title ?? "JSON"}</span>
        <CopyButton value={text} ghost />
      </div>
      <pre>{parts}</pre>
    </div>
  );
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function timeAgo(value: string | null): string {
  if (!value) return "jamais";
  const s = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}
