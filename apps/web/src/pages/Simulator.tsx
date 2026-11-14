// Documentation générée à partir du YAML publié (aucune donnée saisie à la main).
import { useEffect, useMemo, useState } from "react";
import { parse } from "yaml";
import { api, errorMessage, isExecutable, type SimulatorSummary } from "../api.js";
import { Link } from "../router.js";
import { useSession } from "../session.js";
import { Alert, CodeBlock, Icon, JsonView, Method, OnlineBadge, Skeleton, SimulatorBadges } from "../ui.js";

interface FullSimulator extends SimulatorSummary {
  yaml: string;
}

/** Explication exacte, d'après les conditions du moteur (#28), quand `executable` est faux. */
function notExecutableReason(sim: FullSimulator): string {
  if (sim.status === "unpublished") return "Simulateur retiré du catalogue : le moteur ne l'exécute plus (réponse 404). Sa documentation reste consultable.";
  if (sim.endpoints.length === 0 && sim.menus === 0)
    return "La version courante de ce simulateur ne passe plus la validation du schéma : le moteur ne l'exécute pas (réponse 404). Publiez une version corrigée.";
  return "Le moteur n'exécute pas ce simulateur (réponse 404) : sa version courante n'est pas exécutable. Publiez une nouvelle version depuis l'éditeur.";
}

interface Doc {
  endpoints?: {
    id: string;
    method: string;
    path: string;
    response?: { status?: number; body?: unknown };
    webhook?: { event?: string; on?: string };
    phone?: { screen?: string };
  }[];
  scenarios?: Record<string, { endpoint?: string; match?: Record<string, string>; response?: { status?: number; body?: unknown }; delay?: string }>;
  menus?: Record<string, { text?: string }>;
  auth?: string;
}

export function SimulatorPage({ slug }: { slug: string }) {
  const { config, user } = useSession();
  const [sim, setSim] = useState<FullSimulator | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"doc" | "yaml">("doc");

  useEffect(() => {
    setSim(null);
    api<{ simulator: FullSimulator }>(`/api/simulators/${encodeURIComponent(slug)}`)
      .then((r) => setSim(r.simulator))
      .catch((err) => setError(errorMessage(err)));
  }, [slug]);

  const doc = useMemo<Doc>(() => {
    try {
      const raw = (sim ? parse(sim.yaml) : {}) as Doc | null;
      if (!raw || typeof raw !== "object") return {};
      // Un YAML qui ne passe plus le schéma (simulateur non exécutable) peut avoir n'importe quelle forme :
      // on ne garde que des sections bien typées, pour afficher la page sans planter.
      const isObj = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
      return {
        ...raw,
        endpoints: Array.isArray(raw.endpoints) ? raw.endpoints.filter((e) => isObj(e) && typeof e.path === "string" && typeof e.method === "string") : undefined,
        scenarios: isObj(raw.scenarios) ? raw.scenarios : undefined,
        menus: isObj(raw.menus) ? raw.menus : undefined,
      };
    } catch {
      return {};
    }
  }, [sim]);

  if (error) return <Alert>{error}</Alert>;
  if (!sim) {
    return (
      <div className="stack">
        <Skeleton h={30} w={320} />
        <Skeleton h={16} w={480} />
        <Skeleton h={240} />
      </div>
    );
  }
  const engine = config?.engineUrl ?? "";
  const first = doc.endpoints?.[0];
  const curl = first
    ? `curl -X ${first.method} ${engine}/${sim.slug}${first.path.replace(/\{[^}]+\}/g, "exemple-123")} \\\n  -H "Authorization: Bearer sk_test_VOTRE_CLE" \\\n  -H "Content-Type: application/json"${first.method === "GET" ? "" : ` \\\n  -d '{"amount": 5000}'`}`
    : "";

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ marginBottom: "0.5rem" }}>
            <span className="badge badge-info">{sim.kind === "ussd" ? `USSD ${sim.code ?? ""}` : "API HTTP"}</span>
            <span className="badge">v{sim.version}</span>
            {isExecutable(sim) && <OnlineBadge />}
            <SimulatorBadges status={sim.status} origin={sim.origin} />
          </div>
          <h1 className="mono" style={{ fontSize: "1.35rem", wordBreak: "break-all" }}>
            {sim.slug}
          </h1>
          <p>{sim.description}</p>
          {sim.forkedFrom && (
            <p className="small">
              <Icon name="git" size={13} /> Fork de <Link to={`/catalogue/${sim.forkedFrom}`}>{sim.forkedFrom}</Link>
            </p>
          )}
        </div>
        <div className="row">
          <Link to={`/editeur?fork=${sim.slug}`} className="btn">
            <Icon name="git" /> Forker
          </Link>
          <Link to={user ? "/app/simulateurs" : "/inscription"} className="btn btn-primary">
            {user ? "Utiliser dans mon projet" : "Créer un compte pour l'utiliser"}
          </Link>
        </div>
      </div>

      {!isExecutable(sim) ? (
        <div style={{ marginBottom: "1rem" }}>
          <Alert kind="warn">{notExecutableReason(sim)}</Alert>
        </div>
      ) : sim.status !== "verified" ? (
        <div style={{ marginBottom: "1rem" }}>
          <Alert kind="info">
            Simulateur communautaire en ligne : le moteur l'exécute avec votre clé de test, mais il n'a pas été vérifié par l'équipe Hifrica.
            Relisez son YAML avant de vous y fier.
          </Alert>
        </div>
      ) : null}
      <div className="segmented" style={{ marginBottom: "1rem" }} role="tablist">
        <button role="tab" aria-selected={tab === "doc"} className={tab === "doc" ? "on" : ""} onClick={() => setTab("doc")}>
          Documentation
        </button>
        <button role="tab" aria-selected={tab === "yaml"} className={tab === "yaml" ? "on" : ""} onClick={() => setTab("yaml")}>
          Source YAML
        </button>
      </div>

      {tab === "yaml" ? (
        <div className="stack">
          <CodeBlock code={sim.yaml} title={`${sim.slug}.yaml`} />
          <p className="xs muted">Publié sous licence CC BY 4.0.</p>
        </div>
      ) : (
        <div className="split">
          <div className="stack">
            {sim.kind === "http" && (
              <div className="panel">
                <div className="panel-head">
                  <h2>Endpoints</h2>
                  <span className="xs muted mono truncate">{engine}/{sim.slug}</span>
                </div>
                <div>
                  {(doc.endpoints ?? []).map((e, i) => (
                    <div key={e.id} style={{ padding: "1rem 1.25rem", borderTop: i ? "1px solid var(--border)" : undefined }} className="stack-sm">
                      <div className="spread">
                        <div className="row-nw">
                          <Method method={e.method} />
                          <code style={{ color: "var(--text)" }}>{e.path}</code>
                          <span className="xs muted">{e.id}</span>
                        </div>
                        <div className="row">
                          {e.response?.status && <span className="badge">→ {e.response.status}</span>}
                          {e.phone && <span className="badge badge-ok"><Icon name="phone" size={12} /> Téléphone</span>}
                          {e.webhook && <span className="badge badge-info">Webhook {e.webhook.event}</span>}
                        </div>
                      </div>
                      {e.webhook?.on && <p className="xs muted">Webhook « {e.webhook.event} » envoyé sur l'événement {e.webhook.on}.</p>}
                      {e.response?.body !== undefined && <JsonView title={`Réponse ${e.response.status ?? ""}`} value={e.response.body} />}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {sim.kind === "ussd" && doc.menus && (
              <div className="panel">
                <div className="panel-head">
                  <h2>Menus USSD</h2>
                  <code>{sim.code}</code>
                </div>
                <div className="panel-body stack">
                  {Object.entries(doc.menus).map(([id, m]) => (
                    <div key={id}>
                      <div className="mono small" style={{ marginBottom: "0.3rem" }}>{id}</div>
                      <CodeBlock code={m.text ?? ""} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="panel">
              <div className="panel-head">
                <h2>Scénarios d'échec</h2>
                <span className="badge">{Object.keys(doc.scenarios ?? {}).length}</span>
              </div>
              {doc.scenarios && Object.keys(doc.scenarios).length > 0 ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Scénario</th>
                        <th className="hide-sm">Endpoint</th>
                        <th>Condition</th>
                        <th>Effet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(doc.scenarios).map(([key, s]) => (
                        <tr key={key}>
                          <td><span className="badge badge-warn">{key}</span></td>
                          <td className="mono small hide-sm">{s.endpoint ?? "—"}</td>
                          <td className="small">{s.match ? Object.entries(s.match).map(([k, v]) => `${k} ${v}`).join(", ") : "toujours"}</td>
                          <td className="small">
                            {s.response?.status ? <span className={`status-code s${String(s.response.status)[0]}`}>{s.response.status}</span> : null}
                            {s.delay ? ` délai ${s.delay}` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="panel-body small muted">Aucun scénario d'échec déclaré.</div>
              )}
              <div className="panel-foot xs muted">
                Activez un scénario dans <Link to="/app/simulateurs">Simulateurs</Link>, ou pour une seule requête avec l'en-tête <code>X-Hifrica-Scenario</code>.
              </div>
            </div>
          </div>
          <div className="stack">
            {curl && <CodeBlock code={curl} title="Exemple cURL" />}
            <div className="panel panel-pad stack-sm">
              <h3>Authentification</h3>
              <p className="small muted">
                En-tête <code>Authorization: Bearer sk_test_…</code> avec une clé de votre projet. <Link to="/app/cles">Gérer mes clés</Link>
              </p>
            </div>
            <div className="panel panel-pad stack-sm">
              <h3>Licence</h3>
              <p className="small muted">Simulateur communautaire publié sous CC BY 4.0. Aucune marque réelle reproduite.</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
