// Vue d'ensemble du projet actif, sur le modèle de l'accueil de projet Supabase : en-tête (nom, statut,
// identifiant, « Connecter »), « Bien démarrer » calculé sur l'état réel, puis l'utilisation sur une période
// (requêtes, temps de réponse, simulateurs appelés), la dernière activité et la fiche du projet.
//
// Uniquement des données réelles : journal du projet, clés, webhook, catalogue. Le journal est lu par pages de
// 100 (limite de l'API) et au plus MAX_LOGS requêtes. Quand cette limite (ou une erreur de pagination) coupe
// l'historique avant le début d'une période, la période est dite PARTIELLE : les totaux sont affichés comme des
// minimums (« 500+ »), un bandeau l'explique et les créneaux non chargés sont hachurés, jamais montrés à zéro.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api, errorMessage, isExecutable, rankSimulators, type LogEntry, type ProjectDetail, type SimulatorSummary } from "../api.js";
import { useProjects } from "../projects.js";
import { Link } from "../router.js";
import { useSession } from "../session.js";
import { Alert, CopyButton, Empty, Icon, Method, Modal, OnlineBadge, Skeleton, StatusCode, formatDate, timeAgo } from "../ui.js";

/** Taille de page maximale de GET /api/projects/:id/logs. */
const PAGE = 100;
/** Requêtes chargées au plus (5 pages) : au-delà, les statistiques des périodes concernées sont partielles. */
const MAX_LOGS = 500;
/** Simulateurs listés un par un ; au-delà, les suivants sont regroupés dans une ligne « N autres ». */
const SIM_ROWS = 5;

type Period = "1h" | "24h" | "7d";
const PERIODS: { value: Period; label: string }[] = [
  { value: "1h", label: "60 min" },
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 jours" },
];

const fmt = new Intl.NumberFormat("fr-FR");
const MIN = 60_000;

/** Créneaux calés sur le calendrier local (5 min, heure, jour), le dernier contenant « maintenant ».
 * Ainsi un créneau ne chevauche jamais minuit, et chaque libellé porte sa date. */
function slotBounds(period: Period, now: number): { start: number; end: number }[] {
  if (period === "7d") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    const days: { start: number; end: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const s = new Date(d);
      s.setDate(d.getDate() - i);
      const e = new Date(s);
      e.setDate(s.getDate() + 1);
      days.push({ start: s.getTime(), end: e.getTime() });
    }
    return days;
  }
  if (period === "24h") {
    const h = new Date(now);
    h.setMinutes(0, 0, 0);
    return Array.from({ length: 24 }, (_, k) => {
      const s = new Date(h);
      s.setHours(h.getHours() - (23 - k));
      const e = new Date(s);
      e.setHours(s.getHours() + 1);
      return { start: s.getTime(), end: e.getTime() };
    });
  }
  const last = Math.floor(now / (5 * MIN)) * 5 * MIN;
  return Array.from({ length: 12 }, (_, k) => ({ start: last - (11 - k) * 5 * MIN, end: last - (10 - k) * 5 * MIN }));
}

/** Couverture d'un créneau par le journal chargé. */
type Coverage = "full" | "partial" | "none";

interface Bucket {
  start: number;
  end: number;
  ok: number;
  c4: number;
  c5: number;
  total: number;
  avg: number | null;
  coverage: Coverage;
}

/** `loadedFrom` : date de la plus ancienne requête chargée quand l'historique est tronqué, sinon null. */
function bucketize(logs: LogEntry[], period: Period, now: number, loadedFrom: number | null): Bucket[] {
  const bounds = slotBounds(period, now);
  const out = bounds.map((b) => ({
    ...b,
    ok: 0,
    c4: 0,
    c5: 0,
    total: 0,
    avg: null as number | null,
    sum: 0,
    coverage: (loadedFrom === null || loadedFrom <= b.start ? "full" : loadedFrom >= b.end ? "none" : "partial") as Coverage,
  }));
  const from = bounds[0].start;
  for (const l of logs) {
    const t = Date.parse(l.createdAt);
    if (t < from || t > now) continue;
    const b = out.find((x) => t >= x.start && t < x.end) ?? out[out.length - 1];
    b.total += 1;
    b.sum += l.durationMs;
    // Sans réponse (délai, abandon) : compté avec les erreurs serveur, comme dans la console.
    if (l.status === null || l.status >= 500) b.c5 += 1;
    else if (l.status >= 400) b.c4 += 1;
    else b.ok += 1;
  }
  return out.map(({ sum, ...b }) => ({ ...b, avg: b.total ? Math.round(sum / b.total) : null }));
}

const dayFmt = (t: number) => new Date(t).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const hmFmt = (t: number) => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dateTimeFmt = (t: number) => `${new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} à ${hmFmt(t)}`;

function bucketLabel(b: Bucket, period: Period, now: number): string {
  const live = b.end > now ? " (en cours)" : "";
  if (period === "7d") return `${dayFmt(b.start)}${live}`;
  // Fin affichée à la minute précédente (23:00–23:59) : le créneau reste dans la même journée.
  return `${dayFmt(b.start)} · ${hmFmt(b.start)}–${hmFmt(b.end - MIN)}${live}`;
}

/** Arrondi « propre » du haut de l'axe (1, 2, 5 × 10^n). */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

/** Hachures des créneaux non chargés : distinctes d'un créneau vide (trait gris au ras de l'axe). */
const HATCH: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.07) 0 2px, transparent 2px 7px)",
};

interface Series {
  key: string;
  label: string;
  color: string;
}

/** Histogramme en colonnes (empilées si plusieurs séries) avec infobulle au survol et au clavier. */
function Columns({
  buckets,
  series,
  value,
  period,
  now,
  unit,
  title,
}: {
  buckets: Bucket[];
  series: Series[];
  value: (b: Bucket, key: string) => number;
  period: Period;
  now: number;
  unit?: string;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = buckets.map((b) => (b.coverage === "none" ? 0 : series.reduce((s, x) => s + value(b, x.key), 0)));
  const max = niceMax(Math.max(0, ...totals));
  const H = 96;
  const tip = hover !== null ? buckets[hover] : null;
  const u = unit ? ` ${unit}` : "";
  const coverageText = (b: Bucket) =>
    b.coverage === "none" ? "non chargé (au-delà de l'historique chargé)" : b.coverage === "partial" ? "partiellement chargé" : null;
  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <div className="chart-plot" style={{ height: H }}>
        <span className="chart-max" aria-hidden="true">
          {fmt.format(max)}
          {u}
        </span>
        <div className="chart-cols" role="img" aria-label={`${title} : histogramme, détail au survol et dans le tableau`}>
          {buckets.map((b, i) => {
            let acc = 0;
            const cov = coverageText(b);
            return (
              <div
                key={i}
                className={hover === i ? "chart-slot on" : "chart-slot"}
                style={b.coverage === "full" ? undefined : HATCH}
                data-coverage={b.coverage}
                tabIndex={0}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${bucketLabel(b, period, now)} : ${
                  b.coverage === "none" ? "non chargé" : series.map((s) => `${s.label} ${fmt.format(value(b, s.key))}${u}`).join(", ")
                }${cov && b.coverage === "partial" ? ` (${cov})` : ""}`}
              >
                {b.coverage !== "none" && (
                  <div className="chart-stack">
                    {series.map((s) => {
                      const v = value(b, s.key);
                      if (!v) return null;
                      const h = Math.max(2, (v / max) * H);
                      acc += h;
                      return <span key={s.key} className="chart-seg" style={{ height: h, background: s.color }} />;
                    })}
                    {acc === 0 && <span className="chart-zero" />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {tip && hover !== null && (
          <div
            className="chart-tip"
            role="status"
            // Ancrée au bord du graphique près des extrémités, pour ne jamais sortir de la carte.
            style={
              hover < buckets.length * 0.3
                ? { left: 0 }
                : hover >= buckets.length * 0.7
                  ? { right: 0 }
                  : { left: `${((hover + 0.5) / buckets.length) * 100}%`, transform: "translateX(-50%)" }
            }
          >
            <div className="chart-tip-head">{bucketLabel(tip, period, now)}</div>
            {tip.coverage === "none" ? (
              <div className="muted">Non chargé : au-delà des requêtes chargées. L'activité de ce créneau n'est pas connue ici.</div>
            ) : (
              <>
                {series.map((s) => (
                  <div key={s.key} className="chart-tip-row">
                    <span className="swatch" style={{ background: s.color }} />
                    <strong>
                      {fmt.format(value(tip, s.key))}
                      {u}
                    </strong>
                    <span className="muted">{s.label}</span>
                  </div>
                ))}
                {tip.coverage === "partial" && <div className="muted" style={{ marginTop: "0.25rem" }}>Créneau partiellement chargé : valeurs minimales.</div>}
              </>
            )}
          </div>
        )}
      </div>
      <div className="chart-axis" aria-hidden="true">
        <span>{period === "7d" ? dayFmt(buckets[0].start) : `${dayFmt(buckets[0].start)} ${hmFmt(buckets[0].start)}`}</span>
        <span>maintenant</span>
      </div>
      <div className="sr-only">
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th>Période</th>
              {series.map((s) => (
                <th key={s.key}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {buckets.map((b, i) => (
              <tr key={i}>
                <td>{bucketLabel(b, period, now)}</td>
                {series.map((s) => (
                  <td key={s.key}>{b.coverage === "none" ? "non chargé" : value(b, s.key)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const STATUS_SERIES: Series[] = [
  { key: "ok", label: "Succès (2xx/3xx)", color: "var(--ok)" },
  { key: "c4", label: "Erreurs client (4xx)", color: "var(--warn)" },
  { key: "c5", label: "Erreurs serveur (5xx, sans réponse)", color: "var(--err)" },
];
const LATENCY_SERIES: Series[] = [{ key: "avg", label: "Temps moyen", color: "var(--info)" }];

function ConnectModal({ engineUrl, onClose }: { engineUrl: string; onClose: () => void }) {
  const base = engineUrl.replace(/\/$/, "");
  const curl = `curl -X POST ${base}/paiement-mobile-generique/v1/checkout \\
  -H "Authorization: Bearer sk_test_…" \\
  -H "Content-Type: application/json" \\
  -d '{"amount": 15000, "merchant": "Boutique Awa"}'`;
  return (
    <Modal title="Connecter votre app" description="Appelez les simulateurs comme une vraie API, avec une clé de test de ce projet." onClose={onClose} width={620}>
      <div className="stack">
        <div className="field">
          <span className="label">URL des simulateurs</span>
          <div className="row-nw">
            <code className="input mono" style={{ display: "flex", alignItems: "center", overflow: "hidden" }}>
              <span className="truncate">{base}</span>
            </code>
            <CopyButton value={base} />
          </div>
        </div>
        <div className="code">
          <div className="code-head">
            <span>Premier appel (cURL)</span>
            <CopyButton value={curl} ghost />
          </div>
          <pre>{curl}</pre>
        </div>
        <p className="small muted">
          Remplacez <code>sk_test_…</code> par une clé de ce projet. Chaque appel apparaît dans la console en quelques secondes.
        </p>
      </div>
      <div className="row" style={{ marginTop: "1.25rem", justifyContent: "flex-end" }}>
        <Link to="/app/console" className="btn">
          <Icon name="terminal" /> Console
        </Link>
        <Link to="/app/cles" className="btn btn-primary">
          <Icon name="key" /> Créer une clé
        </Link>
      </div>
    </Modal>
  );
}

/** Résultat du chargement du journal :
 * - complete : tout l'historique est chargé (plus de page suivante) ;
 * - truncated : l'historique s'arrête à `loadedFrom` (limite MAX_LOGS ou erreur), des requêtes plus anciennes existent. */
interface LogLoad {
  logs: LogEntry[];
  complete: boolean;
  truncated: null | { reason: "limit" | "error"; loadedFrom: number; message?: string };
}

async function loadLogs(projectId: string, horizon: number): Promise<LogLoad> {
  const all: LogEntry[] = [];
  let before: string | null = null;
  for (;;) {
    const q: string = before ? `&before=${encodeURIComponent(before)}` : "";
    let page: { logs: LogEntry[]; next: string | null };
    try {
      page = await api(`/api/projects/${projectId}/logs?limit=${PAGE}${q}`);
    } catch (err) {
      // Première page en échec : rien à montrer, l'erreur remonte. Page suivante : on garde ce qui est chargé,
      // marqué tronqué à la plus ancienne requête reçue.
      if (all.length === 0) throw err;
      return { logs: all, complete: false, truncated: { reason: "error", loadedFrom: Date.parse(all[all.length - 1].createdAt), message: errorMessage(err) } };
    }
    all.push(...page.logs);
    const last = page.logs[page.logs.length - 1];
    if (!page.next || !last) return { logs: all, complete: true, truncated: null };
    // Assez remonté pour la plus longue période : les périodes affichées sont complètes.
    if (Date.parse(last.createdAt) < horizon) return { logs: all, complete: false, truncated: null };
    if (all.length >= MAX_LOGS) return { logs: all, complete: false, truncated: { reason: "limit", loadedFrom: Date.parse(last.createdAt) } };
    before = page.next;
  }
}

export function Overview() {
  const { user, config } = useSession();
  const { projects, active } = useProjects();
  const [load, setLoad] = useState<LogLoad | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [catalog, setCatalog] = useState<SimulatorSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("24h");
  const [connect, setConnect] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<{ simulators: SimulatorSummary[] }>("/api/simulators")
      .then((r) => setCatalog(rankSimulators(r.simulators)))
      .catch(() => setCatalog([]));
  }, []);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const t = Date.now();
    setLoad(null);
    setLogsError(null);
    setDetail(null);
    setError(null);
    setNow(t);
    // Horizon : début du plus ancien créneau de la plus longue période (7 jours calés sur minuit).
    const horizon = slotBounds("7d", t)[0].start;
    loadLogs(active.id, horizon)
      .then((l) => alive && setLoad(l))
      .catch((err) => alive && setLogsError(errorMessage(err)));
    api<ProjectDetail>(`/api/projects/${active.id}`)
      .then((d) => alive && setDetail(d))
      .catch((err) => alive && setError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [active, reload]);

  const logs = load?.logs ?? null;
  const loadedFrom = load?.truncated?.loadedFrom ?? null;
  const buckets = useMemo(() => (logs ? bucketize(logs, period, now, loadedFrom) : null), [logs, period, now, loadedFrom]);
  const periodStart = buckets?.[0].start ?? now;
  /** La période choisie remonte avant la plus ancienne requête chargée : ses statistiques sont des minimums. */
  const partial = loadedFrom !== null && loadedFrom > periodStart;

  const usage = useMemo(() => {
    if (!logs || !buckets) return null;
    const inPeriod = logs.filter((l) => {
      const t = Date.parse(l.createdAt);
      return t >= periodStart && t <= now;
    });
    const total = inPeriod.length;
    const ok = buckets.reduce((s, b) => s + b.ok, 0);
    const avg = total ? Math.round(inPeriod.reduce((s, l) => s + l.durationMs, 0) / total) : null;
    const bySim = new Map<string, number>();
    for (const l of inPeriod) bySim.set(l.simulator, (bySim.get(l.simulator) ?? 0) + 1);
    const sorted = [...bySim.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    // Tous les simulateurs s'ils tiennent en SIM_ROWS lignes ; sinon les SIM_ROWS - 1 premiers + « N autres ».
    const rows: { label: string; n: number; others?: number }[] =
      sorted.length <= SIM_ROWS
        ? sorted.map(([label, n]) => ({ label, n }))
        : [
            ...sorted.slice(0, SIM_ROWS - 1).map(([label, n]) => ({ label, n })),
            { label: `${sorted.length - (SIM_ROWS - 1)} autres simulateurs`, n: sorted.slice(SIM_ROWS - 1).reduce((s, [, n]) => s + n, 0), others: sorted.length - (SIM_ROWS - 1) },
          ];
    return {
      total,
      rate: total ? Math.round((ok / total) * 100) : null,
      avg,
      distinct: bySim.size,
      rows,
      // Largeurs relatives au plus grand total affiché (ligne « autres » comprise) : jamais plus de 100 %.
      rowMax: Math.max(1, ...rows.map((r) => r.n)),
      failures: inPeriod.filter((l) => l.scenarioKey).length,
    };
  }, [logs, buckets, now, periodStart]);

  if (projects && projects.length === 0) {
    return (
      <>
        <div className="ov-head">
          <div>
            <h1>Bienvenue, {user?.name}</h1>
            <p className="muted" style={{ marginTop: "0.3rem" }}>Trois étapes pour votre premier appel de simulateur.</p>
          </div>
        </div>
        <div className="grid cols-3">
          {[
            { n: "01", t: "Créez un projet", d: "Il regroupe vos clés, votre webhook et votre journal.", to: "/app/projets?nouveau=1", cta: "Créer un projet", primary: true },
            { n: "02", t: "Explorez le catalogue", d: "Paiement mobile, USSD, SMS : choisissez un simulateur.", to: "/catalogue", cta: "Ouvrir le catalogue" },
            { n: "03", t: "Écrivez le vôtre", d: "Décrivez un service en YAML, validé en direct.", to: "/editeur", cta: "Ouvrir l'éditeur" },
          ].map((s) => (
            <div key={s.n} className="panel panel-pad stack" style={{ display: "flex", flexDirection: "column" }}>
              <span className="mono" style={{ color: "var(--accent)" }}>{s.n}</span>
              <div>
                <h3>{s.t}</h3>
                <p className="muted small" style={{ marginTop: "0.3rem" }}>{s.d}</p>
              </div>
              <Link to={s.to} className={s.primary ? "btn btn-primary" : "btn"} style={{ marginTop: "auto", alignSelf: "flex-start" }}>
                {s.cta}
              </Link>
            </div>
          ))}
        </div>
      </>
    );
  }

  const activeKeys = detail?.keys.filter((k) => !k.revokedAt).length ?? 0;
  const scenarioCount = detail ? Object.values(detail.scenarios).filter(Boolean).length : 0;
  // « Tester un scénario d'échec » : fait si une requête chargée en porte un ; à faire seulement si TOUT
  // l'historique est chargé sans en trouver ; sinon non vérifiable (un test plus ancien peut exister).
  const failureSeen = logs?.some((l) => l.scenarioKey) ?? false;
  type StepState = "done" | "todo" | "unknown";
  const failureState: StepState = failureSeen ? "done" : load?.complete ? "todo" : "unknown";
  const steps: { state: StepState; t: string; d: string; to: string; cta: string }[] | null =
    detail && logs
      ? [
          { state: activeKeys > 0 ? "done" : "todo", t: "Créer une clé de test", d: "Elle authentifie votre app auprès des simulateurs.", to: "/app/cles", cta: "Créer une clé" },
          { state: logs.length > 0 ? "done" : "todo", t: "Envoyer un premier appel", d: "Depuis votre app, la console ou la boutique démo.", to: "/app/console", cta: "Ouvrir la console" },
          { state: detail.project.webhookUrl ? "done" : "todo", t: "Configurer le webhook", d: "Recevez les confirmations de paiement signées.", to: "/app/parametres", cta: "Configurer" },
          {
            state: failureState,
            t: "Tester un scénario d'échec",
            d:
              failureState === "unknown"
                ? `Aucun dans les ${fmt.format(logs.length)} requêtes chargées ; un test plus ancien n'est pas visible ici.`
                : "Solde insuffisant, délai dépassé : votre app tient-elle ?",
            to: "/app/simulateurs",
            cta: "Activer un scénario",
          },
        ]
      : null;
  const doneCount = steps?.filter((s) => s.state === "done").length ?? 0;
  const unknownCount = steps?.filter((s) => s.state === "unknown").length ?? 0;
  const showSteps = steps && doneCount < steps.length;
  const plus = partial ? "+" : "";
  const truncation = load?.truncated ?? null;

  return (
    <>
      <div className="ov-head">
        <div style={{ minWidth: 0 }}>
          <div className="row-nw" style={{ gap: "0.6rem", flexWrap: "wrap" }}>
            <h1 className="truncate">{active?.name ?? "Vue d'ensemble"}</h1>
            <span className="badge badge-ok">
              <span className="dot" /> Mode test
            </span>
          </div>
          {detail && (
            <div className="ov-meta">
              <span className="ov-pill" title="Identifiant du projet">
                <span className="muted">ID</span> <span className="mono">{detail.project.id.slice(0, 8)}…</span>
                <CopyButton value={detail.project.id} ghost />
              </span>
              <span className="ov-pill">
                <Icon name="key" size={13} /> {activeKeys} clé{activeKeys > 1 ? "s" : ""} active{activeKeys > 1 ? "s" : ""}
              </span>
              <span className="ov-pill">
                <Icon name="zap" size={13} /> {scenarioCount ? `${scenarioCount} scénario(s) d'échec actif(s)` : "Scénarios nominaux"}
              </span>
              <span className="ov-pill">
                <Icon name="clock" size={13} /> Créé le {formatDate(detail.project.createdAt)}
              </span>
            </div>
          )}
        </div>
        <div className="row">
          <Link to="/app/console" className="btn">
            <Icon name="terminal" /> Console
          </Link>
          <button className="btn btn-primary" onClick={() => setConnect(true)}>
            <Icon name="zap" /> Connecter
          </button>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}

      {showSteps && steps && (
        <section className="panel ov-start" aria-labelledby="ov-start-title">
          <div className="panel-head">
            <h2 id="ov-start-title">Bien démarrer</h2>
            <span className="small muted">
              {doneCount}/{steps.length} étapes{unknownCount ? ` · ${unknownCount} non vérifiable${unknownCount > 1 ? "s" : ""}` : ""}
            </span>
          </div>
          <div className="bar" style={{ margin: 0, borderRadius: 0, height: 3 }} aria-hidden="true">
            <span style={{ width: `${(doneCount / steps.length) * 100}%`, background: "var(--accent)" }} />
          </div>
          <ol className="ov-steps">
            {steps.map((s) => (
              <li key={s.t} className={s.state === "done" ? "done" : ""} data-state={s.state}>
                <span className="ov-check" aria-hidden="true" style={s.state === "unknown" ? { borderStyle: "dashed", color: "var(--muted)", fontSize: "0.7rem", fontWeight: 600 } : undefined}>
                  {s.state === "done" ? <Icon name="check" /> : s.state === "unknown" ? "?" : null}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="ov-step-title">
                    {s.t}
                    <span className="sr-only">{s.state === "done" ? " (fait)" : s.state === "unknown" ? " (non vérifiable)" : " (à faire)"}</span>
                  </div>
                  <div className="xs muted">{s.d}</div>
                </div>
                {s.state !== "done" && (
                  <Link to={s.to} className="btn btn-sm">
                    {s.cta}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-labelledby="ov-usage-title">
        <div className="ov-section-head">
          <div>
            <h2 id="ov-usage-title">Utilisation</h2>
            <p className="xs muted">
              {truncation
                ? `Calculée sur les ${fmt.format(logs?.length ?? 0)} requêtes les plus récentes chargées.`
                : "Calculée sur le journal du projet."}{" "}
              Détail de chaque appel dans la console.
            </p>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Période">
            {PERIODS.map((x) => (
              <button key={x.value} role="radio" aria-checked={period === x.value} className={period === x.value ? "on" : ""} onClick={() => setPeriod(x.value)}>
                {x.label}
              </button>
            ))}
          </div>
        </div>

        {logsError && (
          <div style={{ marginBottom: "1rem" }}>
            <Alert>
              Journal du projet indisponible : {logsError}{" "}
              <button className="btn btn-sm" style={{ marginLeft: "0.5rem" }} onClick={() => setReload((n) => n + 1)}>
                <Icon name="refresh" /> Réessayer
              </button>
            </Alert>
          </div>
        )}
        {partial && truncation && (
          <div style={{ marginBottom: "1rem" }} data-testid="ov-partial">
            <Alert kind="warn">
              <strong>Statistiques partielles pour « {PERIODS.find((p) => p.value === period)?.label} ».</strong>{" "}
              {truncation.reason === "limit"
                ? `Cette page charge au plus les ${fmt.format(MAX_LOGS)} requêtes les plus récentes (pages de ${PAGE}) et le projet en compte davantage.`
                : `Le chargement du journal s'est interrompu (${truncation.message ?? "erreur"}) après ${fmt.format(logs?.length ?? 0)} requêtes.`}{" "}
              Elles remontent au {dateTimeFmt(truncation.loadedFrom)} : avant, la période n'est pas chargée (créneaux hachurés), ce qui ne signifie pas
              une absence d'activité. Les totaux sont des minimums.{" "}
              {truncation.reason === "error" ? (
                <button className="btn btn-sm" style={{ marginLeft: "0.25rem" }} onClick={() => setReload((n) => n + 1)}>
                  <Icon name="refresh" /> Réessayer
                </button>
              ) : (
                <Link to="/app/console">Journal complet dans la console →</Link>
              )}
            </Alert>
          </div>
        )}

        <div className="grid cols-3 ov-usage">
          {logsError ? (
            [0, 1, 2].map((i) => (
              <div key={i} className="panel ov-card" style={{ minHeight: 218, justifyContent: "center", alignItems: "center" }}>
                <span className="xs muted">Données indisponibles</span>
              </div>
            ))
          ) : !buckets || !usage ? (
            [0, 1, 2].map((i) => <Skeleton key={i} h={218} />)
          ) : (
            <>
              <div className="panel ov-card">
                <div className="ov-card-head">
                  <span className="stat-label"><Icon name="activity" /> Requêtes</span>
                  <Link to="/app/console" className="xs">Console →</Link>
                </div>
                <div className="stat-value" title={partial ? "Au moins : historique tronqué" : undefined}>
                  {fmt.format(usage.total)}
                  {plus}
                </div>
                <div className="stat-sub">
                  {usage.rate === null ? "Aucune requête sur la période" : `${usage.rate} % de réussite${partial ? " (requêtes chargées)" : ""}`}
                </div>
                <Columns buckets={buckets} series={STATUS_SERIES} value={(b, k) => b[k as "ok" | "c4" | "c5"]} period={period} now={now} title="Requêtes par statut" />
                <ul className="chart-legend">
                  {STATUS_SERIES.map((s) => (
                    <li key={s.key}><span className="swatch" style={{ background: s.color }} /> {s.key === "ok" ? "2xx" : s.key === "c4" ? "4xx" : "5xx"}</li>
                  ))}
                  {partial && (
                    <li><span className="swatch" style={{ ...HATCH, border: "1px solid var(--border-strong)" }} /> non chargé</li>
                  )}
                </ul>
              </div>
              <div className="panel ov-card">
                <div className="ov-card-head">
                  <span className="stat-label"><Icon name="clock" /> Temps de réponse moyen</span>
                </div>
                <div className="stat-value">{usage.avg === null ? "—" : `${fmt.format(usage.avg)} ms`}</div>
                <div className="stat-sub">
                  {partial ? `sur les ${fmt.format(usage.total)} requêtes chargées de la période` : "mesuré par le moteur, latence simulée comprise"}
                </div>
                <Columns buckets={buckets} series={LATENCY_SERIES} value={(b) => b.avg ?? 0} period={period} now={now} unit="ms" title="Temps de réponse moyen" />
              </div>
              <div className="panel ov-card">
                <div className="ov-card-head">
                  <span className="stat-label"><Icon name="layers" /> Simulateurs appelés</span>
                  <Link to="/app/simulateurs" className="xs">Gérer →</Link>
                </div>
                <div className="stat-value" title={partial ? "Au moins : historique tronqué" : undefined}>
                  {fmt.format(usage.distinct)}
                  {plus}
                </div>
                <div className="stat-sub">
                  {usage.failures ? `${fmt.format(usage.failures)}${plus} appel(s) en scénario d'échec` : "aucun scénario d'échec sur la période"}
                  {partial ? " · requêtes chargées" : ""}
                </div>
                {usage.rows.length === 0 ? (
                  <p className="xs muted ov-empty">Aucun appel sur la période.</p>
                ) : (
                  <ul className="hbars">
                    {usage.rows.map((r) => (
                      <li key={r.label}>
                        <div className="hbar-label">
                          <span className={r.others ? "truncate muted" : "mono truncate"}>{r.label}</span>
                          <strong>
                            {fmt.format(r.n)}
                            {plus}
                          </strong>
                        </div>
                        <div className="hbar-track" aria-hidden="true">
                          <span style={{ width: `${Math.min(100, (r.n / usage.rowMax) * 100)}%`, ...(r.others ? { background: "var(--faint)" } : null) }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <div className="split-2-1" style={{ marginTop: "1rem" }}>
        <div className="panel">
          <div className="panel-head">
            <h2>Dernière activité</h2>
            <Link to="/app/console" className="btn btn-ghost btn-sm">
              Tout voir <Icon name="chevron" />
            </Link>
          </div>
          {logsError ? (
            <p className="small muted" style={{ padding: "1.25rem" }}>Journal indisponible pour le moment.</p>
          ) : !logs ? (
            <div style={{ padding: "1rem" }}>
              <Skeleton h={160} />
            </div>
          ) : logs.length === 0 ? (
            <Empty icon="activity" title="Aucune requête pour l'instant" action={<button className="btn btn-primary" onClick={() => setConnect(true)}><Icon name="zap" /> Connecter votre app</button>}>
              Appelez un simulateur depuis votre app ou depuis la console : chaque appel apparaîtra ici.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {logs.slice(0, 8).map((l) => (
                    <tr key={l.id}>
                      <td style={{ width: 52 }}><StatusCode status={l.status} /></td>
                      <td className="hide-sm" style={{ width: 70 }}><Method method={l.method} /></td>
                      <td className="mono small" style={{ maxWidth: 0, width: "100%" }}><div className="truncate">{l.path}</div></td>
                      <td className="hide-sm">{l.scenarioKey ? <span className="badge badge-warn">{l.scenarioKey}</span> : <span className="xs muted">nominal</span>}</td>
                      <td className="num small muted" style={{ whiteSpace: "nowrap" }}>{timeAgo(l.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="stack">
          {detail && (
            <div className="panel">
              <div className="panel-head">
                <h2>Projet</h2>
                <Link to="/app/parametres" className="btn btn-ghost btn-sm">
                  <Icon name="settings" /> Paramètres
                </Link>
              </div>
              <div className="panel-body">
                <dl className="kv" style={{ gridTemplateColumns: "100px minmax(0,1fr)" }}>
                  <dt>Webhook</dt>
                  <dd className="mono xs truncate" title={detail.project.webhookUrl ?? undefined}>
                    {detail.project.webhookUrl ?? <span className="muted">non configuré</span>}
                  </dd>
                  <dt>Créé le</dt>
                  <dd className="small">{formatDate(detail.project.createdAt)}</dd>
                  <dt>Identifiant</dt>
                  <dd className="row-nw">
                    <span className="mono xs truncate">{detail.project.id}</span>
                    <CopyButton value={detail.project.id} ghost />
                  </dd>
                </dl>
              </div>
            </div>
          )}
          <div className="panel">
            <div className="panel-head">
              <h2>Catalogue</h2>
              <span className="badge">{catalog?.length ?? "…"}</span>
            </div>
            <div className="panel-body stack-sm">
              {!catalog ? (
                <Skeleton h={60} />
              ) : catalog.length === 0 ? (
                <p className="muted small">Aucun simulateur publié.</p>
              ) : (
                catalog.slice(0, 4).map((s) => (
                  <Link key={s.slug} to={`/catalogue/${s.slug}`} className="row-nw" style={{ color: "var(--text-2)", justifyContent: "space-between" }}>
                    <span className="row-nw" style={{ minWidth: 0 }}>
                      <Icon name="layers" size={15} />
                      <span className="mono small truncate">{s.slug}</span>
                    </span>
                    {isExecutable(s) ? <OnlineBadge /> : <span className="xs muted">non exécutable</span>}
                  </Link>
                ))
              )}
            </div>
            <div className="panel-foot">
              <Link to="/catalogue" className="small">Parcourir le catalogue →</Link>
            </div>
          </div>
        </div>
      </div>

      {connect && <ConnectModal engineUrl={config?.engineUrl ?? window.location.origin} onClose={() => setConnect(false)} />}
    </>
  );
}
