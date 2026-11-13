import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage, type ProjectDetail } from "../api.js";
import { useProjects } from "../projects.js";
import { useSession } from "../session.js";
import { PageHead } from "../shell.js";
import { Alert, CopyButton, Icon, Skeleton, Spinner, formatDate, useToast } from "../ui.js";

export function SettingsPage() {
  const { active, refresh } = useProjects();
  const { user } = useSession();
  const toast = useToast();
  const projectId = active!.id;
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDetail(null);
    setSecret(null);
    api<ProjectDetail>(`/api/projects/${projectId}`)
      .then((d) => {
        setDetail(d);
        setName(d.project.name);
        setWebhookUrl(d.project.webhookUrl ?? "");
      })
      .catch((err) => setError(errorMessage(err)));
  }, [projectId]);

  const dirty = detail && (name !== detail.project.name || webhookUrl !== (detail.project.webhookUrl ?? ""));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}`, { method: "PATCH", body: { name, webhookUrl: webhookUrl.trim() || null } });
      setDetail((d) => (d ? { ...d, project: { ...d.project, name, webhookUrl: webhookUrl.trim() || null } } : d));
      toast("Paramètres enregistrés");
      void refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    try {
      const r = await api<{ secret: string }>(`/api/projects/${projectId}/webhook-secret`);
      setSecret(r.secret);
      setShowSecret(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!detail) {
    return (
      <>
        <PageHead title="Paramètres" />
        {error ? <Alert>{error}</Alert> : <Skeleton h={260} />}
      </>
    );
  }

  return (
    <>
      <PageHead title="Paramètres" description={`Projet « ${detail.project.name} », créé le ${formatDate(detail.project.createdAt)}.`} />
      {error && <div style={{ marginBottom: "1rem" }}><Alert>{error}</Alert></div>}
      <div className="stack">
        <form className="panel" onSubmit={save}>
          <div className="panel-head">
            <h2>Général</h2>
          </div>
          <div className="panel-body stack">
            <div className="field">
              <label className="label" htmlFor="sname">Nom du projet</label>
              <input id="sname" className="input" style={{ maxWidth: 420 }} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </div>
            <div className="field">
              <label className="label" htmlFor="swh">URL de webhook</label>
              <input id="swh" className="input mono" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://mon-app.example/webhooks" />
              <span className="hint">http ou https. Laissez vide pour ne recevoir aucun webhook.</span>
            </div>
          </div>
          <div className="panel-foot spread">
            <span className="xs muted">{dirty ? "Modifications non enregistrées" : "À jour"}</span>
            <button className="btn btn-primary" disabled={busy || !dirty || !name.trim()}>
              {busy ? <Spinner /> : "Enregistrer"}
            </button>
          </div>
        </form>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Secret de signature des webhooks</h2>
              <p className="small muted" style={{ marginTop: "0.2rem" }}>Secret HMAC-SHA256 propre au projet, chiffré en base (AES-256-GCM).</p>
            </div>
          </div>
          <div className="panel-body stack">
            {secret ? (
              <div className="row-nw">
                <div className="secret-box grow">{showSecret ? secret : `whsec_${"•".repeat(32)}`}</div>
                <button className="btn btn-icon" onClick={() => setShowSecret((v) => !v)} aria-label={showSecret ? "Masquer" : "Afficher"}>
                  <Icon name={showSecret ? "eyeOff" : "eye"} />
                </button>
                <CopyButton value={secret} small={false} />
              </div>
            ) : (
              <button className="btn" onClick={reveal}>
                <Icon name="eye" /> Afficher le secret
              </button>
            )}
            <Alert kind="info">
              En cours d'intégration : les webhooks sont pour l'instant signés avec le secret global du serveur ; la signature par ce secret de projet arrive avec la tâche A5.
            </Alert>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Compte</h2>
          </div>
          <div className="panel-body">
            <dl className="kv">
              <dt>Nom</dt>
              <dd>{user?.name}</dd>
              <dt>Email</dt>
              <dd>{user?.email}</dd>
              <dt>Identifiant du projet</dt>
              <dd className="mono xs">{detail.project.id}</dd>
            </dl>
          </div>
        </div>
      </div>
    </>
  );
}
