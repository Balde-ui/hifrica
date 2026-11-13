import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, errorMessage, rememberKey, rememberedKey, type LogEntry, type SendResult, type SimulatorSummary } from "../api.js";
import { Alert, Empty, Loading, Spinner, StatusCode, formatDate } from "../ui.js";

const OUTCOME_LABEL: Record<LogEntry["outcome"], string> = {
  responded: "Répondu",
  client_aborted: "Client parti",
  response_failed: "Envoi échoué",
  timeout: "Délai dépassé",
};

const STATUS_HELP: Record<number, string> = {
  200: "Succès.",
  201: "Ressource créée : le paiement est en attente de validation.",
  401: "Clé de test absente, invalide ou révoquée.",
  402: "Paiement refusé par le scénario actif (ex. solde insuffisant) : votre app doit afficher l'échec au client.",
  404: "Simulateur ou endpoint inconnu : vérifiez le nom du simulateur et le chemin.",
  422: "Données refusées par le simulateur.",
  500: "Erreur du moteur de simulation.",
};

/** Console : journal réel (request_logs), actualisé automatiquement, et envoi de requêtes de test. */
export function Console({ projectId, catalog, keysAvailable }: { projectId: string; catalog: SimulatorSummary[]; keysAvailable: boolean }) {
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [selected, setSelected] = useState<LogEntry | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ logs: LogEntry[] }>(`/api/projects/${projectId}/logs?limit=50`);
      setLogs(r.logs);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
    if (!live) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [refresh, live]);

  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <Sender projectId={projectId} catalog={catalog} keysAvailable={keysAvailable} onSent={refresh} />
      <div className="card">
        <div className="card-head">
          <h2 style={{ margin: 0 }}>Journal des requêtes</h2>
          <div className="row">
            <label className="row small" style={{ gap: "0.3rem" }}>
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Actualisation auto
            </label>
            <button className="btn btn-sm" onClick={() => void refresh()}>
              Actualiser
            </button>
          </div>
        </div>
        {error && <Alert>{error}</Alert>}
        {!logs && !error && <Loading />}
        {logs && logs.length === 0 && (
          <Empty title="Aucune requête reçue">
            Envoyez une requête avec le formulaire, la boutique démo ou votre propre app : elle apparaîtra ici en quelques secondes.
          </Empty>
        )}
        {logs && logs.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Heure</th>
                  <th>Requête</th>
                  <th>Statut</th>
                  <th>Durée</th>
                  <th>Scénario</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="clickable" onClick={() => setSelected(l)}>
                    <td className="small">{new Date(l.createdAt).toLocaleTimeString("fr-FR")}</td>
                    <td>
                      <span className="mono">{l.method}</span> <span className="small">{l.path}</span>
                    </td>
                    <td>
                      <StatusCode status={l.status} />
                      {l.outcome !== "responded" && <span className="badge badge-warn" style={{ marginLeft: 4 }}>{OUTCOME_LABEL[l.outcome]}</span>}
                    </td>
                    <td className="small">{l.durationMs} ms</td>
                    <td>{l.scenarioKey ? <span className="badge badge-warn">{l.scenarioKey}</span> : <span className="muted small">nominal</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {selected && (
          <div className="card" style={{ marginTop: "1rem", background: "var(--surface-2)" }}>
            <div className="spread">
              <h3 style={{ margin: 0 }}>Détail</h3>
              <button className="btn btn-sm" onClick={() => setSelected(null)}>
                Fermer
              </button>
            </div>
            <dl className="kv" style={{ marginTop: "0.6rem" }}>
              <dt>Date</dt>
              <dd>{formatDate(selected.createdAt)}</dd>
              <dt>Simulateur</dt>
              <dd>{selected.simulator}</dd>
              <dt>Endpoint</dt>
              <dd>{selected.endpointId ?? "—"}</dd>
              <dt>Requête</dt>
              <dd className="mono">
                {selected.method} {selected.path}
              </dd>
              <dt>Statut</dt>
              <dd>
                <StatusCode status={selected.status} /> {selected.status !== null && STATUS_HELP[selected.status]}
              </dd>
              <dt>Issue</dt>
              <dd>{OUTCOME_LABEL[selected.outcome]}</dd>
              <dt>Scénario</dt>
              <dd>{selected.scenarioKey ?? "nominal"}</dd>
              <dt>Durée</dt>
              <dd>{selected.durationMs} ms</dd>
              <dt>Identifiant</dt>
              <dd className="mono small">{selected.requestId}</dd>
            </dl>
            <p className="small muted" style={{ marginTop: "0.6rem", marginBottom: 0 }}>
              Par sécurité, les corps des requêtes ne sont pas conservés dans le journal (aucun PIN ni secret stocké).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Sender({ projectId, catalog, keysAvailable, onSent }: { projectId: string; catalog: SimulatorSummary[]; keysAvailable: boolean; onSent: () => void }) {
  const http = catalog.filter((s) => s.kind === "http" && s.endpoints.length > 0);
  const [key, setKey] = useState(() => rememberedKey(projectId));
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

  function selectSimulator(nextSlug: string) {
    const next = http.find((s) => s.slug === nextSlug);
    if (!next) return;
    setSlug(next.slug);
    setScenario("");
    chooseEndpoint(next.endpoints[0].id, next);
  }

  // Premier simulateur HTTP sélectionné dès que le catalogue est chargé.
  useEffect(() => {
    if (!slug && http.length > 0) selectSimulator(http[0].slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [http.length]);

  function chooseEndpoint(id: string, from: SimulatorSummary | undefined = sim) {
    const ep = from?.endpoints.find((e) => e.id === id);
    if (!ep) return;
    setEndpointId(id);
    setMethod(ep.method);
    // Les paramètres de chemin ({id}) sont remplacés par une valeur d'exemple modifiable.
    setPath(ep.path.replace(/\{[^}]+\}/g, "exemple-123"));
  }

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

  if (http.length === 0) {
    return (
      <div className="card">
        <Empty title="Aucun simulateur HTTP disponible">Publiez un simulateur depuis l'éditeur pour le tester ici.</Empty>
      </div>
    );
  }

  return (
    <form className="card stack" onSubmit={send}>
      <h2>Envoyer une requête de test</h2>
      {!keysAvailable && <Alert kind="warn">Créez d'abord une clé dans l'onglet « Clés de test ».</Alert>}
      <div className="field">
        <label htmlFor="ckey">Clé de test</label>
        <input id="ckey" className="input mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk_test_…" autoComplete="off" spellCheck={false} />
        <span className="hint">Mémorisée dans cet onglet après la création d'une clé. Jamais stockée sur le serveur.</span>
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="csim">Simulateur</label>
          <select id="csim" className="input" value={slug} onChange={(e) => selectSimulator(e.target.value)}>
            {http.map((s) => (
              <option key={s.slug} value={s.slug}>{s.slug}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cep">Endpoint</label>
          <select id="cep" className="input" value={endpointId} onChange={(e) => chooseEndpoint(e.target.value)}>
            {sim?.endpoints.map((ep) => (
              <option key={ep.id} value={ep.id}>{ep.method} {ep.path}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="cpath">Chemin</label>
          <input id="cpath" className="input mono" value={path} onChange={(e) => setPath(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="csc">Scénario pour cette requête</label>
          <select id="csc" className="input" value={scenario} onChange={(e) => setScenario(e.target.value)}>
            <option value="">Scénario actif du projet</option>
            {sim?.scenarios.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      {method !== "GET" && method !== "DELETE" && (
        <div className="field">
          <label htmlFor="cbody">Corps (JSON)</label>
          <textarea id="cbody" className="input" value={body} onChange={(e) => setBody(e.target.value)} rows={6} spellCheck={false} />
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      <div>
        <button className="btn btn-primary" disabled={busy || !key.trim()}>
          {busy ? <Spinner /> : `Envoyer ${method} ${path}`}
        </button>
      </div>
      {result && (
        <div className="stack">
          <div className="spread">
            <div className="row">
              <StatusCode status={result.status} />
              <span className="small muted">{result.durationMs} ms</span>
            </div>
            {result.requestId && <span className="small muted mono">{result.requestId}</span>}
          </div>
          {STATUS_HELP[result.status] && <Alert kind={result.status < 300 ? "ok" : "warn"}>{STATUS_HELP[result.status]}</Alert>}
          <div className="codeblock">
            <pre>{typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2)}</pre>
          </div>
        </div>
      )}
    </form>
  );
}
