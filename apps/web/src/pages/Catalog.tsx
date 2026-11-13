import { useEffect, useState } from "react";
import { api, errorMessage, isExecutable, type SimulatorSummary } from "../api.js";
import { Link } from "../router.js";
import { PageHead } from "../shell.js";
import { Alert, Empty, Icon, Skeleton, SimulatorBadges } from "../ui.js";

export function CatalogPage() {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"" | "http" | "ussd">("");
  const [items, setItems] = useState<SimulatorSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (kind) params.set("kind", kind);
      api<{ simulators: SimulatorSummary[] }>(`/api/simulators?${params}`, { signal: ctrl.signal })
        .then((r) => {
          setItems([...r.simulators].sort((a, b) => Number(isExecutable(b)) - Number(isExecutable(a))));
          setError(null);
        })
        .catch((err) => {
          if ((err as Error).name !== "AbortError") setError(errorMessage(err));
        });
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, kind]);

  return (
    <>
      <PageHead
        title="Catalogue"
        description="Simulateurs publiés par la communauté : utilisez-les avec votre clé de test, consultez leur documentation ou forkez-les."
        actions={
          <Link to="/editeur" className="btn btn-primary">
            <Icon name="plus" /> Nouveau simulateur
          </Link>
        }
      />
      <div className="row" style={{ marginBottom: "1.1rem", gap: "0.6rem" }}>
        <div className="input-group" style={{ flex: 1, minWidth: 220 }}>
          <Icon name="search" />
          <input className="input" placeholder="Rechercher : paiement, ussd, sms, transfert…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
        </div>
        <div className="segmented" role="group" aria-label="Type">
          {(
            [
              ["", "Tous"],
              ["http", "API HTTP"],
              ["ussd", "USSD"],
            ] as ["" | "http" | "ussd", string][]
          ).map(([k, label]) => (
            <button key={k} className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {!items && !error && (
        <div className="grid cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} h={170} />
          ))}
        </div>
      )}
      {items && items.length === 0 && (
        <div className="panel">
          <Empty icon="search" title="Aucun simulateur trouvé" action={<Link to="/editeur" className="btn btn-primary">Créer ce simulateur</Link>}>
            Essayez une autre recherche, ou publiez le premier simulateur de ce service.
          </Empty>
        </div>
      )}
      {items && items.length > 0 && (
        <div className="grid cols-3">
          {items.map((s) => (
            <Link key={s.slug} to={`/catalogue/${s.slug}`} className="panel card-link" style={{ padding: "1.1rem 1.15rem", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
              <div className="spread">
                <span className="feature-icon" style={{ margin: 0, width: 32, height: 32 }}>
                  <Icon name={s.kind === "ussd" ? "phone" : "globe"} />
                </span>
                <span className="row" style={{ gap: "0.3rem" }}>
                  {isExecutable(s) && <span className="badge badge-ok"><span className="dot" /> En ligne</span>}
                  <span className="badge">v{s.version}</span>
                </span>
              </div>
              <div>
                <div className="mono" style={{ color: "var(--text)", fontWeight: 500, fontSize: "0.88rem" }}>
                  {s.slug}
                </div>
                <p className="small muted" style={{ marginTop: "0.3rem", minHeight: "2.6em" }}>
                  {s.description ?? "Pas de description."}
                </p>
              </div>
              <div className="spread" style={{ marginTop: "auto" }}>
                <span className="xs muted">
                  {s.kind === "http" ? `${s.endpoints.length} endpoint${s.endpoints.length > 1 ? "s" : ""}` : `USSD ${s.code ?? ""}`} · {s.scenarios.length} scénario
                  {s.scenarios.length > 1 ? "s" : ""}
                </span>
                <SimulatorBadges status={s.status} origin={s.origin} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
