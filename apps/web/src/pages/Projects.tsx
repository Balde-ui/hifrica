import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "../api.js";
import { useProjects } from "../projects.js";
import { Link, useRouter } from "../router.js";
import { PageHead } from "../shell.js";
import { Alert, Empty, Icon, Modal, SkeletonRows, Spinner, formatDate, useToast } from "../ui.js";

export function ProjectsPage() {
  const { projects, active, select, refresh, error } = useProjects();
  const { search, navigate } = useRouter();
  const [creating, setCreating] = useState(search.get("nouveau") === "1");

  return (
    <>
      <PageHead
        title="Projets"
        description="Un projet correspond à une application que vous testez : il a ses clés, son webhook, ses scénarios et son journal."
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Nouveau projet
          </button>
        }
      />
      {error && <Alert>{error}</Alert>}
      <div className="panel">
        {!projects ? (
          <SkeletonRows rows={3} />
        ) : projects.length === 0 ? (
          <Empty icon="folder" title="Aucun projet" action={<button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" /> Créer mon premier projet</button>}>
            Créez un projet pour obtenir une clé de test et appeler les simulateurs.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Clés actives</th>
                  <th className="hide-sm">Webhook</th>
                  <th className="hide-sm">Créé le</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr
                    key={p.id}
                    className={p.id === active?.id ? "clickable selected" : "clickable"}
                    onClick={() => {
                      select(p.id);
                      navigate("/app");
                    }}
                  >
                    <td>
                      <div className="row-nw">
                        <span className="avatar" style={{ width: 26, height: 26, borderRadius: 6, fontSize: "0.7rem" }}>{p.name.slice(0, 2)}</span>
                        <strong style={{ fontWeight: 500 }}>{p.name}</strong>
                        {p.id === active?.id && <span className="badge badge-ok">Actif</span>}
                      </div>
                    </td>
                    <td>{p.activeKeys}</td>
                    <td className="hide-sm">
                      {p.webhookUrl ? <span className="mono xs text-2 truncate" style={{ display: "inline-block", maxWidth: 240 }}>{p.webhookUrl}</span> : <span className="muted small">—</span>}
                    </td>
                    <td className="hide-sm small muted">{formatDate(p.createdAt)}</td>
                    <td className="num">
                      <Icon name="chevron" size={16} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && (
        <CreateProject
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false);
            await refresh();
            select(id);
            navigate("/app/cles?nouveau=1");
          }}
        />
      )}
    </>
  );
}

function CreateProject({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [name, webhookUrl]);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ project: { id: string } }>("/api/projects", {
        body: { name, ...(webhookUrl.trim() ? { webhookUrl: webhookUrl.trim() } : {}) },
      });
      toast("Projet créé");
      onCreated(r.project.id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Nouveau projet"
      description="Vous créerez ensuite sa première clé de test."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => submit()}>
            {busy ? <Spinner /> : "Créer le projet"}
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="pname">
            Nom du projet
          </label>
          <input id="pname" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus placeholder="Boutique de mon PFE" />
        </div>
        <div className="field">
          <label className="label" htmlFor="pwh">
            URL de webhook <span className="muted">(facultatif)</span>
          </label>
          <input id="pwh" className="input" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://mon-app.example/webhooks/paiement" />
          <span className="hint">Votre app y recevra les notifications (paiement confirmé, refusé…). Modifiable dans les paramètres.</span>
        </div>
        {error && <Alert>{error}</Alert>}
        <button type="submit" hidden />
      </form>
      <p className="xs muted" style={{ marginTop: "0.9rem" }}>
        Besoin d'aide ? <Link to="/catalogue">Voir les simulateurs disponibles</Link>
      </p>
    </Modal>
  );
}
