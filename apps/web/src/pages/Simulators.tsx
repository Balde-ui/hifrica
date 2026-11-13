// Simulateurs utilisés par le projet actif : scénario d'échec actif par simulateur.
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, isExecutable, type ProjectDetail, type SimulatorSummary } from "../api.js";
import { useProjects } from "../projects.js";
import { Link } from "../router.js";
import { PageHead } from "../shell.js";
import { Alert, Empty, Icon, Skeleton, SimulatorBadges, Spinner, useToast } from "../ui.js";

export function SimulatorsPage() {
  const { active } = useProjects();
  const projectId = active!.id;
  const toast = useToast();
  const [catalog, setCatalog] = useState<SimulatorSummary[] | null>(null);
  const [scenarios, setScenarios] = useState<Record<string, string | null> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(() => {
    api<ProjectDetail>(`/api/projects/${projectId}`)
      .then((d) => setScenarios(d.scenarios))
      .catch((err) => setError(errorMessage(err)));
  }, [projectId]);

  useEffect(() => {
    setScenarios(null);
    load();
    api<{ simulators: SimulatorSummary[] }>("/api/simulators")
      .then((r) => setCatalog([...r.simulators].sort((a, b) => Number(isExecutable(b)) - Number(isExecutable(a)))))
      .catch((err) => setError(errorMessage(err)));
  }, [load]);

  async function set(slug: string, scenario: string | null) {
    setSaving(`${slug}:${scenario ?? ""}`);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/scenario`, { method: "PUT", body: { simulator: slug, scenario } });
      setScenarios((s) => ({ ...(s ?? {}), [slug]: scenario }));
      toast(scenario ? `Scénario « ${scenario} » activé` : "Retour au scénario nominal");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <PageHead
        title="Simulateurs"
        description="Choisissez le comportement de chaque simulateur pour ce projet. L'en-tête X-Hifrica-Scenario reste prioritaire pour une requête donnée."
        actions={
          <Link to="/catalogue" className="btn">
            <Icon name="grid" /> Catalogue
          </Link>
        }
      />
      {error && <Alert>{error}</Alert>}
      {!catalog || !scenarios ? (
        <div className="stack">
          <Skeleton h={120} />
          <Skeleton h={120} />
        </div>
      ) : catalog.length === 0 ? (
        <div className="panel">
          <Empty icon="layers" title="Aucun simulateur publié" action={<Link to="/editeur" className="btn btn-primary">Créer un simulateur</Link>} />
        </div>
      ) : (
        <div className="stack">
          <div className="section-title">En ligne · servis par le moteur</div>
          {catalog.filter(isExecutable).map((s) => {
            const current = scenarios[s.slug] ?? null;
            const options: (string | null)[] = [null, ...s.scenarios];
            return (
              <div key={s.slug} className="panel">
                <div className="panel-head">
                  <div className="row-nw grow">
                    <span className="feature-icon hide-xs" style={{ margin: 0, width: 32, height: 32, flex: "none" }}>
                      <Icon name={s.kind === "ussd" ? "phone" : "globe"} />
                    </span>
                    <div className="grow">
                      <div className="row">
                        <Link to={`/catalogue/${s.slug}`} className="mono" style={{ color: "var(--text)", fontWeight: 500, overflowWrap: "anywhere" }}>
                          {s.slug}
                        </Link>
                        <span className="badge">v{s.version}</span>
                        <SimulatorBadges status={s.status} origin={s.origin} />
                      </div>
                      <div className="small muted">{s.description}</div>
                    </div>
                  </div>
                  {current ? <span className="badge badge-warn"><span className="dot" /> {current}</span> : <span className="badge badge-ok"><span className="dot" /> Nominal</span>}
                </div>
                <div className="panel-body">
                  {s.scenarios.length === 0 ? (
                    <p className="small muted">Ce simulateur ne déclare aucun scénario d'échec.</p>
                  ) : (
                    <div className="segmented" role="radiogroup" aria-label={`Scénario de ${s.slug}`}>
                      {options.map((opt) => {
                        const key = `${s.slug}:${opt ?? ""}`;
                        return (
                          <button
                            key={key}
                            role="radio"
                            aria-checked={current === opt}
                            className={current === opt ? "on" : ""}
                            disabled={saving !== null}
                            onClick={() => current !== opt && set(s.slug, opt)}
                          >
                            {saving === key ? <Spinner /> : opt ?? "Nominal"}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {catalog.some((s) => !isExecutable(s)) && (
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2>Publiés par la communauté</h2>
                  <p className="small muted" style={{ marginTop: "0.2rem" }}>
                    Documentés dans le catalogue, pas encore exécutés par le moteur : leurs scénarios seront réglables ici dès leur mise en ligne.
                  </p>
                </div>
                <span className="badge">{catalog.filter((s) => !isExecutable(s)).length}</span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {catalog
                      .filter((s) => !isExecutable(s))
                      .map((s) => (
                        <tr key={s.slug}>
                          <td className="mono small" style={{ maxWidth: 0, width: "100%" }}>
                            <div className="truncate">{s.slug}</div>
                          </td>
                          <td className="hide-sm small muted" style={{ whiteSpace: "nowrap" }}>
                            {s.scenarios.length} scénario{s.scenarios.length > 1 ? "s" : ""}
                          </td>
                          <td className="hide-sm"><span className="badge">v{s.version}</span></td>
                          <td className="num">
                            <Link to={`/catalogue/${s.slug}`} className="btn btn-ghost btn-sm">
                              <Icon name="book" /> <span className="hide-xs">Documentation</span>
                            </Link>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
