// Console développeur : journal réel (request_logs), filtres, détail latéral, envoi de requêtes de test.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, errorMessage, isExecutable, rememberKey, rememberedKey, type LogEntry, type SendResult, type SimulatorSummary } from "../api.js";
import { useProjects } from "../projects.js";
import { Link } from "../router.js";
import { PageHead } from "../shell.js";
import { Alert, Drawer, Empty, Icon, JsonView, Method, SkeletonRows, Spinner, StatusCode, formatDate, timeAgo } from "../ui.js";

const OUTCOME_LABEL: Record<LogEntry["outcome"], string> = {
  responded: "Réponse envoyée",
  client_aborted: "Client déconnecté avant la réponse",
  response_failed: "Échec de l'envoi de la réponse",
  timeout: "Délai du serveur dépassé",
};

const STATUS_HELP: Record<number, { title: string; text: string }> = {
  200: { title: "Succès", text: "La requête a été traitée normalement." },
  201: { title: "Paiement créé", text: "Le paiement est en attente de validation par le client (téléphone simulé), puis un webhook signé est envoyé." },
  401: { title: "Clé refusée", text: "La clé de test est absente, mal formée ou révoquée. Vérifiez l'en-tête Authorization: Bearer sk_test_…." },
  402: { title: "Paiement refusé", text: "Le scénario actif (par ex. « solde insuffisant ») refuse le paiement. Votre app doit afficher l'échec au client sans planter." },
  404: { title: "Introuvable", text: "Simulateur ou endpoint inconnu : vérifiez le nom du simulateur et le chemin déclaré dans son YAML." },
  422: { title: "Données refusées", text: "Le simulateur a rejeté les données envoyées." },
  500: { title: "Erreur du moteur", text: "Le moteur de simulation a rencontré une erreur. Réessayez ; si elle persiste, signalez-la." },
};

type StatusFilter = "all" | "2" | "4" | "5";

export function ConsolePage() {
  const { active } = useProjects();
  const projectId = active!.id;
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [catalog, setCatalog] = useState<SimulatorSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [method, setMethod] = useState("");
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [sending, setSending] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ logs: LogEntry[] }>(`/api/projects/${projectId}/logs?limit=100`);
      setLogs(r.logs);
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [projectId]);

  useEffect(() => {
    setLogs(null);
    void refresh();
    api<{ simulators: SimulatorSummary[] }>("/api/simulators")
      .then((r) => setCatalog(r.simulators))
      .catch(() => setCatalog([]));
  }, [refresh]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [refresh, live]);

  const methods = useMemo(() => [...new Set((logs ?? []).map((l) => l.method))].sort(), [logs]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (logs ?? []).filter((l) => {
      if (status !== "all" && String(l.status ?? "").charAt(0) !== status) return false;
      if (method && l.method !== method) return false;
      if (!needle) return true;
      return [l.path, l.endpointId, l.scenarioKey, l.simulator, String(l.status ?? ""), l.requestId].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [logs, q, status, method]);

  const counts = useMemo(() => {
    const c = { all: logs?.length ?? 0, "2": 0, "4": 0, "5": 0 } as Record<StatusFilter, number>;
    for (const l of logs ?? []) {
      const k = String(l.status ?? "").charAt(0) as StatusFilter;
      if (k in c) c[k]++;
    }
    return c;
  }, [logs]);

  return (
    <>
      <PageHead
        title="Console"
        description="Chaque requête reçue par les simulateurs avec une clé de ce projet. Les corps ne sont jamais conservés (aucun PIN ni secret stocké)."
        actions={
          <button className="btn btn-primary" onClick={() => setSending(true)}>
            <Icon name="send" /> Nouvelle requête
          </button>
        }
      />
      {error && logs && <div style={{ marginBottom: "1rem" }}><Alert>{error} Les données affichées peuvent être anciennes.</Alert></div>}
      <div className="panel">
        <div className="toolbar">
          <div className="input-group">
            <Icon name="search" />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un chemin, endpoint, scénario, identifiant…" aria-label="Rechercher" />
          </div>
          <div className="segmented" role="group" aria-label="Filtrer par statut">
            {(
              [
                ["all", "Tous"],
                ["2", "2xx"],
                ["4", "4xx"],
                ["5", "5xx"],
              ] as [StatusFilter, string][]
            ).map(([k, label]) => (
              <button key={k} className={status === k ? "on" : ""} aria-pressed={status === k} onClick={() => setStatus(k)}>
                {label} <span className="muted">{counts[k]}</span>
              </button>
            ))}
          </div>
          <select className="input" style={{ width: 130 }} value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Méthode">
            <option value="">Méthodes</option>
            {methods.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className="row" style={{ marginLeft: "auto" }}>
            <button className={live ? "live btn btn-ghost btn-sm" : "live off btn btn-ghost btn-sm"} onClick={() => setLive((v) => !v)} aria-pressed={live} title="Actualisation automatique toutes les 3 s">
              <span className="dot" /> {live ? "En direct" : "En pause"}
            </button>
            <button className="btn btn-sm btn-icon" onClick={() => void refresh()} aria-label="Actualiser" title="Actualiser">
              <Icon name="refresh" />
            </button>
          </div>
        </div>
        {!logs && error ? (
          <Empty icon="alert" title="Journal indisponible" action={<button className="btn" onClick={() => void refresh()}><Icon name="refresh" /> Réessayer</button>}>
            {error}
          </Empty>
        ) : !logs ? (
          <SkeletonRows rows={6} cols={5} />
        ) : logs.length === 0 ? (
          <Empty icon="terminal" title="Aucune requête reçue" action={<button className="btn btn-primary" onClick={() => setSending(true)}><Icon name="send" /> Envoyer une requête de test</button>}>
            Envoyez une requête depuis la console, la <Link to="/demo">boutique démo</Link> ou votre app : elle apparaît ici en quelques secondes.
          </Empty>
        ) : filtered.length === 0 ? (
          <Empty icon="filter" title="Aucun résultat" action={<button className="btn" onClick={() => { setQ(""); setStatus("all"); setMethod(""); }}>Réinitialiser les filtres</button>}>
            Aucune requête ne correspond à ces filtres.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Statut</th>
                  <th className="hide-sm">Méthode</th>
                  <th>Endpoint</th>
                  <th className="hide-sm">Scénario</th>
                  <th className="num">Durée</th>
                  <th className="num hide-sm">Date</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr
                    key={l.id}
                    className={selected?.id === l.id ? "clickable selected" : "clickable"}
                    onClick={() => setSelected(l)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && setSelected(l)}
                  >
                    <td>
                      <StatusCode status={l.status} />
                      {l.outcome !== "responded" && <span className="badge badge-warn" style={{ marginLeft: 6 }}>interrompue</span>}
                    </td>
                    <td className="hide-sm"><Method method={l.method} /></td>
                    <td className="mono small" style={{ maxWidth: 0, width: "100%" }}>
                      <div className="truncate">{l.path}</div>
                    </td>
                    <td className="hide-sm">{l.scenarioKey ? <span className="badge badge-warn">{l.scenarioKey}</span> : <span className="xs muted">nominal</span>}</td>
                    <td className="num small">{l.durationMs} ms</td>
                    <td className="num small muted hide-sm" title={formatDate(l.createdAt)}>{timeAgo(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {logs && (
          <div className="panel-foot spread xs muted">
            <span>
              {filtered.length} requête{filtered.length > 1 ? "s" : ""} affichée{filtered.length > 1 ? "s" : ""} sur {logs.length} (100 dernières)
            </span>
            {updatedAt && <span>Mis à jour à {updatedAt.toLocaleTimeString("fr-FR")}</span>}
          </div>
        )}
      </div>

      {selected && <LogDetail log={selected} onClose={() => setSelected(null)} />}
      {sending && <SendDrawer projectId={projectId} catalog={catalog} onClose={() => setSending(false)} onSent={refresh} />}
    </>
  );
}

function LogDetail({ log, onClose }: { log: LogEntry; onClose: () => void }) {
  const help = log.status !== null ? STATUS_HELP[log.status] : undefined;
  return (
    <Drawer
      title={
        <>
          <Method method={log.method} /> <span className="mono small truncate">{log.path}</span>
        </>
      }
      onClose={onClose}
    >
      <div className="stack">
        <div className="row">
          <StatusCode status={log.status} />
          <span className="muted small">· {log.durationMs} ms · {formatDate(log.createdAt)}</span>
        </div>
        {help && (
          <Alert kind={log.status! < 400 ? "ok" : log.status! < 500 ? "warn" : "err"}>
            <strong>{help.title}.</strong> {help.text}
          </Alert>
        )}
        <dl className="kv">
          <dt>Simulateur</dt>
          <dd className="mono small">{log.simulator}</dd>
          <dt>Endpoint</dt>
          <dd className="mono small">{log.endpointId ?? "—"}</dd>
          <dt>Canal</dt>
          <dd>{log.channel.toUpperCase()}</dd>
          <dt>Issue</dt>
          <dd>{OUTCOME_LABEL[log.outcome]}</dd>
          <dt>Scénario</dt>
          <dd>{log.scenarioKey ? <span className="badge badge-warn">{log.scenarioKey}</span> : "nominal"}</dd>
          <dt>Identifiant</dt>
          <dd className="mono xs">{log.requestId}</dd>
          {log.sessionId && (
            <>
              <dt>Session</dt>
              <dd className="mono xs">{log.sessionId}</dd>
            </>
          )}
        </dl>
        <JsonView
          title="Métadonnées journalisées"
          value={{ method: log.method, path: log.path, status: log.status, outcome: log.outcome, durationMs: log.durationMs, scenario: log.scenarioKey, requestId: log.requestId }}
        />
        <p className="xs muted">Les corps de requête et de réponse ne sont jamais stockés : aucun PIN, mot de passe ni secret dans le journal.</p>
      </div>
    </Drawer>
  );
}

function SendDrawer({ projectId, catalog, onClose, onSent }: { projectId: string; catalog: SimulatorSummary[]; onClose: () => void; onSent: () => void }) {
  const http = catalog
    .filter((s) => s.kind === "http" && s.endpoints.length > 0)
    .sort((a, b) => Number(isExecutable(b)) - Number(isExecutable(a)));
  const [key, setKey] = useState(() => rememberedKey(projectId));
  const [showKey, setShowKey] = useState(false);
  const [slug, setSlug] = useState("");
  const [endpointId, setEndpointId] = useState("");
  const [path, setPath] = useState("");
  const [method, setMethod] = useState("POST");
  const [body, setBody] = useState('{\n  "amount": 5000,\n  "merchant": "Boutique démo"\n}');
  const [scenario, setScenario] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const sim = http.find((s) => s.slug === slug);

  function chooseEndpoint(id: string, from: SimulatorSummary | undefined = sim) {
    const ep = from?.endpoints.find((e) => e.id === id);
    if (!ep) return;
    setEndpointId(id);
    setMethod(ep.method);
    setPath(ep.path.replace(/\{[^}]+\}/g, "exemple-123"));
  }

  function selectSimulator(nextSlug: string) {
    const next = http.find((s) => s.slug === nextSlug);
    if (!next) return;
    setSlug(next.slug);
    setScenario("");
    chooseEndpoint(next.endpoints[0].id, next);
  }

  useEffect(() => {
    if (!slug && http.length > 0) selectSimulator(http[0].slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [http.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    let parsed: unknown;
    if (method !== "GET" && method !== "DELETE" && body.trim()) {
      try {
        parsed = JSON.parse(body);
      } catch {
        return setError("Le corps n'est pas un JSON valide.");
      }
    }
    setBusy(true);
    try {
      const r = await api<SendResult>(`/api/projects/${projectId}/send`, {
        body: { key: key.trim(), simulator: slug, method, path, body: parsed, ...(scenario ? { scenario } : {}) },
      });
      rememberKey(projectId, key.trim());
      setResult(r);
      onSent();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const help = result ? STATUS_HELP[result.status] : undefined;
  return (
    <Drawer title={<h2 style={{ fontSize: "0.95rem" }}>Nouvelle requête</h2>} onClose={onClose}>
      {http.length === 0 ? (
        <Empty icon="layers" title="Aucun simulateur HTTP">Publiez un simulateur depuis l'éditeur pour le tester ici.</Empty>
      ) : (
        <form className="stack" onSubmit={send}>
          <div className="field">
            <label className="label" htmlFor="ckey">Clé de test</label>
            <div className="row-nw">
              <input id="ckey" className="input mono" type={showKey ? "text" : "password"} value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk_test_…" autoComplete="off" spellCheck={false} />
              <button type="button" className="btn btn-icon" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "Masquer la clé" : "Afficher la clé"} aria-pressed={showKey}>
                <Icon name={showKey ? "eyeOff" : "eye"} />
              </button>
            </div>
            <span className="hint">
              Reprise de cet onglet après la création d'une clé. <Link to="/app/cles">Gérer les clés</Link>
            </span>
          </div>
          <div className="grid cols-2" style={{ gap: "0.75rem" }}>
            <div className="field">
              <label className="label" htmlFor="csim">Simulateur</label>
              <select id="csim" className="input" value={slug} onChange={(e) => selectSimulator(e.target.value)}>
                {http.map((s) => (
                  <option key={s.slug} value={s.slug}>{s.slug}{isExecutable(s) ? "" : " (pas encore exécuté)"}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="cep">Endpoint</label>
              <select id="cep" className="input" value={endpointId} onChange={(e) => chooseEndpoint(e.target.value)}>
                {sim?.endpoints.map((ep) => (
                  <option key={ep.id} value={ep.id}>{ep.method} {ep.path}</option>
                ))}
              </select>
            </div>
          </div>
          {sim && !isExecutable(sim) && (
            <Alert kind="warn">
              Ce simulateur est publié dans le catalogue mais pas encore exécuté par le moteur (chargement des simulateurs publiés : évolution du moteur à venir). Il répondra 404.
            </Alert>
          )}
          <div className="field">
            <label className="label" htmlFor="cpath">Requête</label>
            <div className="row-nw">
              <Method method={method} />
              <input id="cpath" className="input mono" value={path} onChange={(e) => setPath(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="csc">Scénario pour cette requête</label>
            <select id="csc" className="input" value={scenario} onChange={(e) => setScenario(e.target.value)}>
              <option value="">Scénario actif du projet</option>
              {sim?.scenarios.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <span className="hint">Envoyé dans l'en-tête X-Hifrica-Scenario.</span>
          </div>
          {method !== "GET" && method !== "DELETE" && (
            <div className="field">
              <label className="label" htmlFor="cbody">Corps (JSON)</label>
              <textarea id="cbody" className="input" value={body} onChange={(e) => setBody(e.target.value)} rows={6} spellCheck={false} />
            </div>
          )}
          {error && <Alert>{error}</Alert>}
          <button className="btn btn-primary btn-block" disabled={busy || !key.trim()}>
            {busy ? <Spinner /> : <><Icon name="send" /> Envoyer</>}
          </button>
          {result && (
            <div className="stack" aria-live="polite">
              <div className="spread">
                <div className="row">
                  <StatusCode status={result.status} />
                  <span className="small muted">{result.durationMs} ms</span>
                </div>
                {result.requestId && <span className="xs muted mono truncate" style={{ maxWidth: 220 }}>{result.requestId}</span>}
              </div>
              {help && (
                <Alert kind={result.status < 400 ? "ok" : "warn"}>
                  <strong>{help.title}.</strong> {help.text}
                </Alert>
              )}
              <JsonView title={`Réponse · ${result.contentType ?? "—"}`} value={result.body} />
            </div>
          )}
        </form>
      )}
    </Drawer>
  );
}
