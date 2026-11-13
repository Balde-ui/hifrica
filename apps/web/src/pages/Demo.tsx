// App de démonstration « boutique » (tâche C) : une petite boutique fictive qui encaisse via le
// simulateur « paiement mobile générique ». Chaque paiement est un VRAI appel au moteur, avec une
// vraie clé de test du projet, visible ensuite dans la console.
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage, rememberKey, rememberedKey, type ProjectDetail, type ProjectSummary, type SendResult } from "../api.js";
import { Link, useRouter } from "../router.js";
import { useSession } from "../session.js";
import { Alert, Empty, Loading, Spinner, StatusCode, useToast } from "../ui.js";

const SIMULATOR = "paiement-mobile-generique";

const PRODUCTS = [
  { id: "pagne", name: "Pagne wax 6 yards", price: 15000, emoji: "🧵" },
  { id: "cafe", name: "Café Touba, 1 kg", price: 4500, emoji: "☕" },
  { id: "sac", name: "Sac en cuir artisanal", price: 32000, emoji: "👜" },
  { id: "groupe", name: "Groupe électrogène (commande pro)", price: 650000, emoji: "⚡" },
];

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

export function DemoShop() {
  const { user, loading } = useSession();
  const { search } = useRouter();
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectId, setProjectId] = useState(search.get("projet") ?? "");
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [key, setKey] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({ pagne: 1, cafe: 2 });
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!user) return;
    api<{ projects: ProjectSummary[] }>("/api/projects")
      .then((r) => {
        setProjects(r.projects);
        if (!projectId && r.projects[0]) setProjectId(r.projects[0].id);
      })
      .catch((err) => setError(errorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!projectId) return;
    setKey(rememberedKey(projectId));
    setResult(null);
    api<ProjectDetail>(`/api/projects/${projectId}`)
      .then(setDetail)
      .catch((err) => setError(errorMessage(err)));
  }, [projectId]);

  const total = useMemo(() => PRODUCTS.reduce((sum, p) => sum + p.price * (cart[p.id] ?? 0), 0), [cart]);
  const scenario = detail?.scenarios[SIMULATOR] ?? null;

  async function pay() {
    setPaying(true);
    setError(null);
    setResult(null);
    try {
      const r = await api<SendResult>(`/api/projects/${projectId}/send`, {
        body: { key: key.trim(), simulator: SIMULATOR, method: "POST", path: "/v1/checkout", body: { amount: total, merchant: "Boutique Awa" } },
      });
      rememberKey(projectId, key.trim());
      setResult(r);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPaying(false);
    }
  }

  async function toggleScenario() {
    setSwitching(true);
    try {
      const next = scenario === "solde-insuffisant" ? null : "solde-insuffisant";
      await api(`/api/projects/${projectId}/scenario`, { method: "PUT", body: { simulator: SIMULATOR, scenario: next } });
      setDetail((d) => (d ? { ...d, scenarios: { ...d.scenarios, [SIMULATOR]: next } } : d));
      toast(next ? "Scénario « solde insuffisant » activé" : "Retour au scénario nominal");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSwitching(false);
    }
  }

  if (loading) return <Loading />;
  if (!user) {
    return (
      <div className="card">
        <Empty title="Boutique démo" action={<Link to="/connexion?suite=/demo" className="btn btn-primary">Se connecter</Link>}>
          Cette boutique fictive encaisse ses paiements avec votre projet Hifrica : connectez-vous pour l'utiliser.
        </Empty>
      </div>
    );
  }

  const outcome = result ? interpret(result) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Boutique Awa — démo</h1>
          <p>Une app marchande fictive qui intègre le paiement mobile via Hifrica. Aucun argent réel n'est échangé.</p>
        </div>
        {projectId && (
          <Link to={`/app/projets/${projectId}?onglet=console`} className="btn">
            Voir la console du projet
          </Link>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      {projects && projects.length === 0 && (
        <div className="card">
          <Empty title="Aucun projet" action={<Link to="/app" className="btn btn-primary">Créer un projet</Link>}>
            La boutique a besoin d'un projet et d'une clé de test.
          </Empty>
        </div>
      )}
      {projects && projects.length > 0 && (
        <div className="shop">
          <div className="card">
            <h2>Panier</h2>
            <div className="stack">
              {PRODUCTS.map((p) => (
                <div key={p.id} className="spread">
                  <div className="product">
                    <div className="product-img" aria-hidden="true">{p.emoji}</div>
                    <div>
                      <strong>{p.name}</strong>
                      <div className="price">{fcfa(p.price)}</div>
                    </div>
                  </div>
                  <div className="row">
                    <button className="btn btn-sm" aria-label={`Retirer ${p.name}`} onClick={() => setCart((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] ?? 0) - 1) }))}>−</button>
                    <span style={{ minWidth: 20, textAlign: "center" }}>{cart[p.id] ?? 0}</span>
                    <button className="btn btn-sm" aria-label={`Ajouter ${p.name}`} onClick={() => setCart((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 }))}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="spread" style={{ borderTop: "1px solid var(--border)", marginTop: "1rem", paddingTop: "0.9rem" }}>
              <strong>Total</strong>
              <strong style={{ fontSize: "1.2rem" }}>{fcfa(total)}</strong>
            </div>
            <p className="small muted" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
              Astuce démo : le simulateur refuse les montants supérieurs à 500 000 FCFA quand le scénario « solde insuffisant » est actif
              (ajoutez le groupe électrogène).
            </p>
          </div>
          <div className="stack">
            <div className="card stack">
              <h2>Paiement mobile</h2>
              <div className="field">
                <label htmlFor="dproj">Projet Hifrica de la boutique</label>
                <select id="dproj" className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="dkey">Clé de test</label>
                <input id="dkey" className="input mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk_test_…" autoComplete="off" spellCheck={false} />
                {!key && detail && (
                  <span className="hint">
                    Créez une clé dans <Link to={`/app/projets/${projectId}?onglet=cles`}>l'onglet Clés</Link> : elle sera reprise ici automatiquement.
                  </span>
                )}
              </div>
              <div className="spread">
                <span className="small">
                  Scénario actif : {scenario ? <span className="badge badge-warn">{scenario}</span> : <span className="badge badge-ok">nominal</span>}
                </span>
                <button className="btn btn-sm" onClick={toggleScenario} disabled={switching || !detail}>
                  {scenario === "solde-insuffisant" ? "Revenir au nominal" : "Simuler un solde insuffisant"}
                </button>
              </div>
              <button className="btn btn-primary btn-lg btn-block" disabled={paying || total === 0 || !key.trim()} onClick={pay}>
                {paying ? <Spinner /> : `Payer ${fcfa(total)}`}
              </button>
            </div>
            {outcome && result && (
              <div className="card stack">
                <Alert kind={outcome.kind}>
                  <strong>{outcome.title}</strong> {outcome.text}
                </Alert>
                <div className="spread small">
                  <span>
                    Réponse du simulateur : <StatusCode status={result.status} /> en {result.durationMs} ms
                  </span>
                </div>
                <div className="codeblock receipt">
                  <pre>{JSON.stringify(result.body, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function interpret(r: SendResult): { kind: "ok" | "warn" | "err"; title: string; text: string } {
  const body = (r.body ?? {}) as { status?: string; error?: string };
  if (r.status === 201 || r.status === 200) {
    return {
      kind: "ok",
      title: "Paiement initié.",
      text: `Statut « ${body.status ?? "pending"} » : le client doit valider sur son téléphone ; la boutique sera notifiée par webhook signé.`,
    };
  }
  if (r.status === 402) {
    return { kind: "warn", title: "Paiement refusé : solde insuffisant.", text: "La boutique affiche l'échec et propose un autre moyen de paiement, sans planter." };
  }
  if (r.status === 401) return { kind: "err", title: "Clé refusée.", text: "La clé de test est invalide ou révoquée." };
  return { kind: "err", title: `Erreur ${r.status}.`, text: body.error ?? "Réponse inattendue du simulateur." };
}
