import { useEffect, useMemo, useState } from "react";
import { parse } from "yaml";
import { api, errorMessage, type SimulatorSummary } from "../api.js";
import { Link } from "../router.js";
import { useSession } from "../session.js";
import { Alert, CodeBlock, Loading, SimulatorBadges } from "../ui.js";

interface FullSimulator extends SimulatorSummary {
  yaml: string;
}

interface Doc {
  endpoints?: { id: string; method: string; path: string; response?: { status?: number; body?: unknown }; webhook?: { event?: string; on?: string } ; phone?: { screen?: string } }[];
  scenarios?: Record<string, { endpoint?: string; match?: Record<string, string>; response?: { status?: number; body?: unknown }; delay?: string }>;
  menus?: Record<string, { text?: string }>;
  auth?: string;
}

/** Page de documentation générée à partir du YAML publié (aucune donnée saisie à la main). */
export function SimulatorPage({ slug }: { slug: string }) {
  const { config, user } = useSession();
  const [sim, setSim] = useState<FullSimulator | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showYaml, setShowYaml] = useState(false);

  useEffect(() => {
    api<{ simulator: FullSimulator }>(`/api/simulators/${encodeURIComponent(slug)}`)
      .then((r) => setSim(r.simulator))
      .catch((err) => setError(errorMessage(err)));
  }, [slug]);

  const doc = useMemo<Doc>(() => {
    try {
      return (sim ? parse(sim.yaml) : {}) as Doc;
    } catch {
      return {};
    }
  }, [sim]);

  if (error) return <Alert>{error}</Alert>;
  if (!sim) return <Loading />;
  const engine = config?.engineUrl ?? "";

  return (
    <>
      <div className="page-head">
        <div>
          <p className="small">
            <Link to="/catalogue">← Catalogue</Link>
          </p>
          <h1 className="mono">{sim.slug}</h1>
          <p>{sim.description}</p>
          <div className="row" style={{ marginTop: "0.5rem" }}>
            <span className="badge badge-info">{sim.kind === "ussd" ? `USSD ${sim.code ?? ""}` : "API HTTP"}</span>
            <span className="badge">v{sim.version}</span>
            <SimulatorBadges status={sim.status} origin={sim.origin} />
            {sim.forkedFrom && (
              <span className="small muted">
                fork de <Link to={`/catalogue/${sim.forkedFrom}`}>{sim.forkedFrom}</Link>
              </span>
            )}
          </div>
        </div>
        <div className="row">
          <Link to={`/editeur?fork=${sim.slug}`} className="btn">
            Forker dans l'éditeur
          </Link>
          <Link to={user ? "/app" : "/inscription"} className="btn btn-primary">
            {user ? "Utiliser dans un projet" : "Créer un compte pour l'utiliser"}
          </Link>
        </div>
      </div>

      {sim.kind === "http" && (
        <div className="card">
          <h2>Endpoints</h2>
          <p className="muted small">
            Base : <code>{engine}/{sim.slug}</code> · Authentification : <code>Authorization: Bearer sk_test_…</code>
          </p>
          <div className="stack">
            {(doc.endpoints ?? []).map((e) => (
              <div key={e.id} style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
                <div className="spread">
                  <div>
                    <span className="badge badge-info mono">{e.method}</span> <code>{e.path}</code>{" "}
                    <span className="small muted">({e.id})</span>
                  </div>
                  <div className="row">
                    {e.response?.status && <span className="badge">→ {e.response.status}</span>}
                    {e.phone && <span className="badge badge-ok">Téléphone simulé</span>}
                    {e.webhook && <span className="badge badge-warn">Webhook {e.webhook.event}{e.webhook.on ? ` (sur ${e.webhook.on})` : ""}</span>}
                  </div>
                </div>
                {e.response?.body !== undefined && (
                  <div className="codeblock" style={{ marginTop: "0.5rem" }}>
                    <pre>{JSON.stringify(e.response.body, null, 2)}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {sim.kind === "ussd" && doc.menus && (
        <div className="card">
          <h2>Menus USSD ({sim.code})</h2>
          <div className="stack">
            {Object.entries(doc.menus).map(([id, m]) => (
              <div key={id}>
                <strong className="mono">{id}</strong>
                <pre className="codeblock" style={{ marginTop: "0.3rem" }}>{m.text}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Scénarios d'échec</h2>
        {doc.scenarios && Object.keys(doc.scenarios).length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Scénario</th>
                  <th>Endpoint</th>
                  <th>Condition</th>
                  <th>Effet</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(doc.scenarios).map(([key, s]) => (
                  <tr key={key}>
                    <td><span className="badge badge-warn">{key}</span></td>
                    <td className="mono small">{s.endpoint ?? "—"}</td>
                    <td className="small">{s.match ? Object.entries(s.match).map(([k, v]) => `${k} ${v}`).join(", ") : "toujours"}</td>
                    <td className="small">
                      {s.response?.status ? `répond ${s.response.status}` : ""}
                      {s.delay ? `${s.response?.status ? ", " : ""}délai ${s.delay}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Aucun scénario d'échec déclaré.</p>
        )}
        <p className="small muted" style={{ marginTop: "0.6rem", marginBottom: 0 }}>
          Activez un scénario depuis votre projet, ou ponctuellement avec l'en-tête <code>X-Hifrica-Scenario: nom-du-scénario</code>.
        </p>
      </div>

      {sim.kind === "http" && doc.endpoints?.[0] && (
        <div className="card">
          <h2>Exemple</h2>
          <CodeBlock
            code={`curl -X ${doc.endpoints[0].method} ${engine}/${sim.slug}${doc.endpoints[0].path} \\\n  -H "Authorization: Bearer sk_test_VOTRE_CLE" \\\n  -H "Content-Type: application/json" \\\n  -d '{"amount": 5000}'`}
          />
        </div>
      )}

      <div className="card">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Source YAML</h2>
          <button className="btn btn-sm" onClick={() => setShowYaml((v) => !v)}>
            {showYaml ? "Masquer" : "Afficher"}
          </button>
        </div>
        {showYaml && (
          <div style={{ marginTop: "0.75rem" }}>
            <CodeBlock code={sim.yaml} />
          </div>
        )}
        <p className="small muted" style={{ marginTop: "0.6rem", marginBottom: 0 }}>Publié sous licence CC BY 4.0.</p>
      </div>
    </>
  );
}
