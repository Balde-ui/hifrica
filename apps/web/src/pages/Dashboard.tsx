import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage, type ProjectSummary } from "../api.js";
import { Link, useRouter } from "../router.js";
import { useSession } from "../session.js";
import { Alert, Empty, Loading, Modal, Spinner, formatDate } from "../ui.js";

export function Dashboard() {
  const { user } = useSession();
  const { navigate } = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api<{ projects: ProjectSummary[] }>("/api/projects")
      .then((r) => setProjects(r.projects))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bonjour {user?.name}</h1>
          <p>Vos projets regroupent vos clés de test, votre URL de webhook et le journal de vos appels.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + Nouveau projet
        </button>
      </div>
      {error && <Alert>{error}</Alert>}
      {!projects && !error && <Loading />}
      {projects && projects.length === 0 && (
        <div className="card">
          <Empty
            title="Aucun projet pour l'instant"
            action={
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                Créer mon premier projet
              </button>
            }
          >
            Un projet correspond à une application que vous voulez tester (votre PFE, la boutique d'un client…).
          </Empty>
        </div>
      )}
      {projects && projects.length > 0 && (
        <div className="grid grid-3">
          {projects.map((p) => (
            <Link key={p.id} to={`/app/projets/${p.id}`} className="card" style={{ color: "inherit", textDecoration: "none" }}>
              <h3>{p.name}</h3>
              <p className="small muted" style={{ marginBottom: "0.5rem" }}>
                Créé le {formatDate(p.createdAt)}
              </p>
              <div className="row">
                <span className={p.activeKeys > 0 ? "badge badge-ok" : "badge"}>
                  {p.activeKeys} clé{p.activeKeys > 1 ? "s" : ""} active{p.activeKeys > 1 ? "s" : ""}
                </span>
                <span className={p.webhookUrl ? "badge badge-info" : "badge"}>{p.webhookUrl ? "Webhook configuré" : "Pas de webhook"}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      {creating && (
        <CreateProject
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(`/app/projets/${id}?nouveau=1`);
          }}
        />
      )}
    </>
  );
}

function CreateProject({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ project: { id: string } }>("/api/projects", {
        body: { name, ...(webhookUrl.trim() ? { webhookUrl: webhookUrl.trim() } : {}) },
      });
      onCreated(r.project.id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title="Nouveau projet" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="pname">Nom du projet</label>
          <input id="pname" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus placeholder="Ex. : Boutique de mon PFE" />
        </div>
        <div className="field">
          <label htmlFor="pwh">URL de webhook (facultatif)</label>
          <input id="pwh" className="input" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://mon-app.example/webhooks/paiement" />
          <span className="hint">Votre app y recevra les notifications signées (paiement confirmé, refusé…). Modifiable plus tard.</span>
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? <Spinner /> : "Créer le projet"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
