// Vue d'ensemble du projet actif : uniquement des données réelles (journal, clés, catalogue).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, errorMessage, isExecutable, type LogEntry, type ProjectDetail, type SimulatorSummary } from "../api.js";
import { useProjects } from "../projects.js";
import { Link } from "../router.js";
import { useSession } from "../session.js";
import { PageHead } from "../shell.js";
import { Alert, CopyButton, Empty, Icon, Method, Skeleton, StatusCode, formatDate, timeAgo, type IconName } from "../ui.js";

const SAMPLE = 100;

function Stat({ icon, label, value, sub, children }: { icon: IconName; label: string; value: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="panel stat">
      <div className="stat-label">
        <Icon name={icon} /> {label}
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      {children}
    </div>
  );
}

export function Overview() {
  const { user } = useSession();
  const { projects, active } = useProjects();
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [catalog, setCatalog] = useState<SimulatorSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ simulators: SimulatorSummary[] }>("/api/simulators")
      .then((r) => setCatalog([...r.simulators].sort((a, b) => Number(isExecutable(b)) - Number(isExecutable(a)))))
      .catch(() => setCatalog([]));
  }, []);

  useEffect(() => {
    if (!active) return;
    setLogs(null);
    setDetail(null);
    Promise.all([
      api<{ logs: LogEntry[] }>(`/api/projects/${active.id}/logs?limit=${SAMPLE}`),
      api<ProjectDetail>(`/api/projects/${active.id}`),
    ])
      .then(([l, d]) => {
        setLogs(l.logs);
        setDetail(d);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [active]);

  const stats = useMemo(() => {
    if (!logs) return null;
    const responded = logs.filter((l) => l.status !== null);
    const ok = responded.filter((l) => l.status! < 400).length;
    const c4 = responded.filter((l) => l.status! >= 400 && l.status! < 500).length;
    const c5 = responded.filter((l) => l.status! >= 500).length;
    const avg = logs.length ? Math.round(logs.reduce((s, l) => s + l.durationMs, 0) / logs.length) : 0;
    return { total: logs.length, ok, c4, c5, rate: responded.length ? Math.round((ok / responded.length) * 100) : null, avg };
  }, [logs]);

  if (projects && projects.length === 0) {
    return (
      <>
        <PageHead title={`Bienvenue, ${user?.name}`} description="Trois étapes pour votre premier appel de simulateur." />
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

  return (
    <>
      <PageHead
        title={active?.name ?? "Vue d'ensemble"}
        description="Activité réelle de ce projet, calculée sur ses dernières requêtes."
        actions={
          <>
            <Link to="/app/console" className="btn">
              <Icon name="terminal" /> Console
            </Link>
            <Link to="/app/cles" className="btn btn-primary">
              <Icon name="key" /> Clés API
            </Link>
          </>
        }
      />
      {error && <Alert>{error}</Alert>}
      <div className="grid cols-4" style={{ marginBottom: "1rem" }}>
        {!stats || !detail ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} h={104} />)
        ) : (
          <>
            <Stat icon="activity" label="Requêtes" value={String(stats.total)} sub={stats.total >= SAMPLE ? `${SAMPLE} dernières` : "depuis la création"} />
            <Stat icon="checkCircle" label="Taux de réussite" value={stats.rate === null ? "—" : `${stats.rate} %`} sub={`${stats.ok} succès · ${stats.c4} 4xx · ${stats.c5} 5xx`}>
              {stats.total > 0 && (
                <div className="bar" aria-hidden="true">
                  <span style={{ width: `${(stats.ok / stats.total) * 100}%`, background: "var(--ok)" }} />
                  <span style={{ width: `${(stats.c4 / stats.total) * 100}%`, background: "var(--warn)" }} />
                  <span style={{ width: `${(stats.c5 / stats.total) * 100}%`, background: "var(--err)" }} />
                </div>
              )}
            </Stat>
            <Stat icon="clock" label="Temps de réponse moyen" value={stats.total ? `${stats.avg} ms` : "—"} sub="mesuré par le moteur" />
            <Stat icon="key" label="Clés actives" value={String(activeKeys)} sub={scenarioCount ? `${scenarioCount} scénario(s) d'échec actif(s)` : "scénarios nominaux"} />
          </>
        )}
      </div>

      <div className="split-2-1">
        <div className="panel">
          <div className="panel-head">
            <h2>Dernière activité</h2>
            <Link to="/app/console" className="btn btn-ghost btn-sm">
              Tout voir <Icon name="chevron" />
            </Link>
          </div>
          {!logs ? (
            <div style={{ padding: "1rem" }}>
              <Skeleton h={160} />
            </div>
          ) : logs.length === 0 ? (
            <Empty icon="activity" title="Aucune requête pour l'instant" action={<Link to="/app/console" className="btn btn-primary"><Icon name="send" /> Envoyer une requête</Link>}>
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
          <div className="panel">
            <div className="panel-head">
              <h2>Simulateurs disponibles</h2>
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
                    <span className="row-nw">
                      <Icon name="layers" size={15} />
                      <span className="mono small truncate">{s.slug}</span>
                    </span>
                    {isExecutable(s) ? <span className="badge badge-ok">En ligne</span> : <span className="xs muted">publié</span>}
                  </Link>
                ))
              )}
            </div>
            <div className="panel-foot">
              <Link to="/catalogue" className="small">Parcourir le catalogue →</Link>
            </div>
          </div>
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
          <div className="panel panel-pad stack-sm">
            <h2>Raccourcis</h2>
            <Link to="/app/simulateurs" className="btn btn-block" style={{ justifyContent: "flex-start" }}><Icon name="zap" /> Activer un scénario d'échec</Link>
            <Link to="/editeur" className="btn btn-block" style={{ justifyContent: "flex-start" }}><Icon name="code" /> Écrire un simulateur</Link>
            <Link to="/demo" className="btn btn-block" style={{ justifyContent: "flex-start" }}><Icon name="cart" /> Tester avec la boutique démo</Link>
          </div>
        </div>
      </div>
    </>
  );
}
