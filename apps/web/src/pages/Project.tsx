import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  api,
  errorMessage,
  rememberKey,
  rememberedKey,
  type ApiKeyView,
  type ProjectDetail,
  type SimulatorSummary,
} from "../api.js";
import { Link, useRouter } from "../router.js";
import { useSession } from "../session.js";
import { Alert, CodeBlock, CopyButton, Empty, Loading, Modal, Spinner, formatDate, useToast } from "../ui.js";
import { Console } from "./Console.js";

type Tab = "demarrage" | "cles" | "scenarios" | "console" | "parametres";

export function ProjectPage({ id }: { id: string }) {
  const { search, navigate } = useRouter();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [catalog, setCatalog] = useState<SimulatorSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const tab = (search.get("onglet") as Tab | null) ?? "demarrage";

  const load = useCallback(() => {
    api<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`)
      .then(setDetail)
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  useEffect(() => {
    load();
    api<{ simulators: SimulatorSummary[] }>("/api/simulators")
      .then((r) => setCatalog(r.simulators))
      .catch(() => setCatalog([]));
  }, [load]);

  const setTab = (t: Tab) => navigate(`/app/projets/${id}?onglet=${t}`, { replace: true });

  if (error) return <Alert>{error}</Alert>;
  if (!detail) return <Loading />;

  const activeKeys = detail.keys.filter((k) => !k.revokedAt);
  return (
    <>
      <div className="page-head">
        <div>
          <p className="small">
            <Link to="/app">← Mes projets</Link>
          </p>
          <h1>{detail.project.name}</h1>
          <p>
            {activeKeys.length} clé{activeKeys.length > 1 ? "s" : ""} active{activeKeys.length > 1 ? "s" : ""} ·{" "}
            {detail.project.webhookUrl ? "webhook configuré" : "aucun webhook"}
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setTab("console")}>
            Ouvrir la console
          </button>
          <Link to={`/demo?projet=${id}`} className="btn btn-primary">
            Tester avec la boutique démo
          </Link>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {(
          [
            ["demarrage", "Démarrage rapide"],
            ["cles", "Clés de test"],
            ["scenarios", "Scénarios"],
            ["console", "Console"],
            ["parametres", "Paramètres"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "demarrage" && <QuickStart detail={detail} catalog={catalog} onGoKeys={() => setTab("cles")} />}
      {tab === "cles" && <Keys projectId={id} keys={detail.keys} onChange={load} highlightCreate={search.get("nouveau") === "1"} />}
      {tab === "scenarios" && <Scenarios projectId={id} catalog={catalog} active={detail.scenarios} onChange={load} />}
      {tab === "console" && <Console projectId={id} catalog={catalog} keysAvailable={activeKeys.length > 0} />}
      {tab === "parametres" && <Settings detail={detail} onChange={load} />}
    </>
  );
}

function QuickStart({ detail, catalog, onGoKeys }: { detail: ProjectDetail; catalog: SimulatorSummary[]; onGoKeys: () => void }) {
  const { config } = useSession();
  const key = rememberedKey(detail.project.id) || "sk_test_VOTRE_CLE";
  const sim = catalog.find((s) => s.kind === "http" && s.endpoints.length > 0);
  const endpoint = sim?.endpoints.find((e) => e.method === "POST") ?? sim?.endpoints[0];
  const engine = config?.engineUrl ?? "";
  const curl = sim && endpoint
    ? `curl -X ${endpoint.method} ${engine}/${sim.slug}${endpoint.path} \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"amount": 5000, "merchant": "Ma boutique"}'`
    : "";
  const hasKey = detail.keys.some((k) => !k.revokedAt);
  return (
    <div className="grid grid-2">
      <div className="card">
        <h2>1. Obtenez une clé de test</h2>
        {hasKey ? (
          <Alert kind="ok">Ce projet a une clé active. {rememberedKey(detail.project.id) ? "Elle est mémorisée pour cette session." : ""}</Alert>
        ) : (
          <>
            <p className="muted">Votre app s'authentifie auprès des simulateurs avec une clé <code>sk_test_…</code>.</p>
            <button className="btn btn-primary" onClick={onGoKeys}>
              Créer une clé de test
            </button>
          </>
        )}
        <h2 style={{ marginTop: "1.2rem" }}>2. Appelez un simulateur</h2>
        {sim ? (
          <>
            <p className="muted">
              Exemple avec <Link to={`/catalogue/${sim.slug}`}>{sim.slug}</Link> :
            </p>
            <CodeBlock code={curl} />
          </>
        ) : (
          <p className="muted">Aucun simulateur HTTP publié pour l'instant.</p>
        )}
      </div>
      <div className="card">
        <h2>3. Jouez les scénarios d'échec</h2>
        <p className="muted">
          Dans l'onglet <strong>Scénarios</strong>, activez par exemple « solde insuffisant » : le simulateur répondra 402
          à votre app, sans changer une ligne de son code. L'en-tête <code>X-Hifrica-Scenario</code> permet aussi de choisir un
          scénario pour une seule requête.
        </p>
        <h2 style={{ marginTop: "1.2rem" }}>4. Suivez chaque appel</h2>
        <p className="muted">
          La <strong>console</strong> affiche chaque requête reçue (méthode, chemin, statut, durée, scénario) et permet d'envoyer
          une requête de test directement depuis le navigateur.
        </p>
      </div>
    </div>
  );
}

function Keys({ projectId, keys, onChange, highlightCreate }: { projectId: string; keys: ApiKeyView[]; onChange: () => void; highlightCreate: boolean }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyView | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ key: string }>(`/api/projects/${projectId}/keys`, { body: { name: name.trim() || undefined } });
      rememberKey(projectId, r.key);
      setCreated(r.key);
      setName("");
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(k: ApiKeyView) {
    try {
      await api(`/api/projects/${projectId}/keys/${k.id}`, { method: "DELETE" });
      toast("Clé révoquée");
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Clés de test</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Seule l'empreinte de la clé est conservée : la clé complète n'est affichée qu'une fois, à sa création.
          </p>
        </div>
        <form className="row" onSubmit={create}>
          <input className="input" style={{ width: 220 }} placeholder="Nom (facultatif)" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Nom de la clé" />
          <button className={highlightCreate && keys.length === 0 ? "btn btn-primary" : "btn"} disabled={busy}>
            {busy ? <Spinner /> : "+ Nouvelle clé"}
          </button>
        </form>
      </div>
      {error && <Alert>{error}</Alert>}
      {keys.length === 0 ? (
        <Empty title="Aucune clé">Créez une clé pour appeler les simulateurs depuis votre app.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Clé</th>
                <th>Nom</th>
                <th>Créée</th>
                <th>Dernière utilisation</th>
                <th>État</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="mono">{k.display}</td>
                  <td>{k.name ?? <span className="muted">—</span>}</td>
                  <td className="small">{formatDate(k.createdAt)}</td>
                  <td className="small">{formatDate(k.lastUsedAt)}</td>
                  <td>{k.revokedAt ? <span className="badge badge-err">Révoquée</span> : <span className="badge badge-ok">Active</span>}</td>
                  <td style={{ textAlign: "right" }}>
                    {!k.revokedAt && (
                      <button className="btn btn-sm btn-danger" onClick={() => setRevoking(k)}>
                        Révoquer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {created && (
        <Modal title="Votre nouvelle clé de test" onClose={() => setCreated(null)}>
          <Alert kind="warn">Copiez-la maintenant : elle ne sera plus jamais affichée.</Alert>
          <div className="secret" style={{ margin: "0.9rem 0" }}>{created}</div>
          <p className="small muted">Elle reste disponible dans cet onglet du navigateur pour la console et la boutique démo, jusqu'à la déconnexion.</p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <CopyButton value={created} label="Copier la clé" className="btn btn-primary" />
            <button className="btn" onClick={() => setCreated(null)}>
              J'ai copié ma clé
            </button>
          </div>
        </Modal>
      )}
      {revoking && (
        <Modal title="Révoquer cette clé ?" onClose={() => setRevoking(null)}>
          <p>
            Les appels avec <code>{revoking.display}</code> seront refusés immédiatement (401). Cette action est définitive.
          </p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setRevoking(null)}>
              Annuler
            </button>
            <button className="btn btn-danger" onClick={() => revoke(revoking)}>
              Révoquer
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Scenarios({
  projectId,
  catalog,
  active,
  onChange,
}: {
  projectId: string;
  catalog: SimulatorSummary[];
  active: Record<string, string | null>;
  onChange: () => void;
}) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const sims = catalog.filter((s) => s.scenarios.length > 0);

  async function set(slug: string, scenario: string | null) {
    setSaving(slug);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/scenario`, { method: "PUT", body: { simulator: slug, scenario } });
      toast(scenario ? `Scénario « ${scenario} » activé` : "Retour au scénario nominal");
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="card">
      <h2>Scénario actif par simulateur</h2>
      <p className="muted">
        Le scénario actif s'applique à tous les appels de ce projet. L'en-tête <code>X-Hifrica-Scenario</code> reste prioritaire
        pour une requête donnée.
      </p>
      {error && <Alert>{error}</Alert>}
      {sims.length === 0 ? (
        <Empty title="Aucun simulateur avec scénarios">Les scénarios d'échec sont déclarés dans le YAML des simulateurs.</Empty>
      ) : (
        <div className="stack">
          {sims.map((s) => {
            const current = active[s.slug] ?? null;
            return (
              <div key={s.slug} className="spread" style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
                <div>
                  <strong>{s.slug}</strong>
                  <div className="small muted">{s.description}</div>
                </div>
                <div className="row">
                  <button className={current === null ? "btn btn-sm btn-primary" : "btn btn-sm"} disabled={saving === s.slug} onClick={() => set(s.slug, null)}>
                    Nominal
                  </button>
                  {s.scenarios.map((sc) => (
                    <button key={sc} className={current === sc ? "btn btn-sm btn-primary" : "btn btn-sm"} disabled={saving === s.slug} onClick={() => set(s.slug, sc)}>
                      {sc}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Settings({ detail, onChange }: { detail: ProjectDetail; onChange: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(detail.project.name);
  const [webhookUrl, setWebhookUrl] = useState(detail.project.webhookUrl ?? "");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${detail.project.id}`, { method: "PATCH", body: { name, webhookUrl: webhookUrl.trim() || null } });
      toast("Projet enregistré");
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    try {
      const r = await api<{ secret: string }>(`/api/projects/${detail.project.id}/webhook-secret`);
      setSecret(r.secret);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="grid grid-2">
      <form className="card stack" onSubmit={save}>
        <h2>Paramètres du projet</h2>
        <div className="field">
          <label htmlFor="sname">Nom</label>
          <input id="sname" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className="field">
          <label htmlFor="swh">URL de webhook</label>
          <input id="swh" className="input" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://mon-app.example/webhooks" />
          <span className="hint">Laisser vide pour ne recevoir aucun webhook.</span>
        </div>
        {error && <Alert>{error}</Alert>}
        <div>
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? <Spinner /> : "Enregistrer"}
          </button>
        </div>
      </form>
      <div className="card">
        <h2>Secret de signature des webhooks</h2>
        <p className="muted">
          Chaque webhook est signé (HMAC-SHA256) avec ce secret propre au projet. Votre app vérifie la signature avant de
          faire confiance à la notification.
        </p>
        {secret ? (
          <div className="stack">
            <div className="secret">{secret}</div>
            <CopyButton value={secret} label="Copier le secret" />
          </div>
        ) : (
          <button className="btn" onClick={reveal}>
            Afficher le secret
          </button>
        )}
      </div>
    </div>
  );
}
