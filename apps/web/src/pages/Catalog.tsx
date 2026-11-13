import { useEffect, useState } from "react";
import { api, errorMessage, type SimulatorSummary } from "../api.js";
import { Link } from "../router.js";
import { Alert, Empty, Loading, SimulatorBadges } from "../ui.js";

export function CatalogPage() {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
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
          setItems(r.simulators);
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
      <div className="page-head">
        <div>
          <h1>Catalogue communautaire</h1>
          <p>Simulateurs publiés : utilisez-les avec votre clé de test, ou forkez-les dans l'éditeur.</p>
        </div>
        <Link to="/editeur" className="btn btn-primary">
          + Nouveau simulateur
        </Link>
      </div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="row">
          <input className="input" style={{ flex: 1, minWidth: 220 }} placeholder="Rechercher (paiement, ussd, sms…)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
          <select className="input" style={{ width: 180 }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
            <option value="">Tous les types</option>
            <option value="http">API HTTP</option>
            <option value="ussd">USSD</option>
          </select>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {!items && !error && <Loading />}
      {items && items.length === 0 && (
        <div className="card">
          <Empty title="Aucun simulateur trouvé" action={<Link to="/editeur" className="btn btn-primary">Créer un simulateur</Link>}>
            Essayez une autre recherche, ou publiez le premier simulateur de ce service.
          </Empty>
        </div>
      )}
      {items && items.length > 0 && (
        <div className="grid grid-3">
          {items.map((s) => (
            <Link key={s.slug} to={`/catalogue/${s.slug}`} className="card" style={{ color: "inherit", textDecoration: "none" }}>
              <div className="spread" style={{ marginBottom: "0.4rem" }}>
                <span className="badge badge-info">{s.kind === "ussd" ? `USSD ${s.code ?? ""}` : "API HTTP"}</span>
                <span className="small muted">v{s.version}</span>
              </div>
              <h3 className="mono" style={{ fontSize: "0.98rem" }}>{s.slug}</h3>
              <p className="small muted">{s.description ?? "Pas de description."}</p>
              <div className="spread">
                <span className="small muted">
                  {s.kind === "http" ? `${s.endpoints.length} endpoint${s.endpoints.length > 1 ? "s" : ""}` : `${s.menus} menu${s.menus > 1 ? "s" : ""}`} ·{" "}
                  {s.scenarios.length} scénario{s.scenarios.length > 1 ? "s" : ""}
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
