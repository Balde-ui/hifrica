import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, errorMessage, isExecutable, rememberKey, rememberedKey, type ApiKeyView, type ProjectDetail, type SimulatorSummary } from "../api.js";
import { useProjects } from "../projects.js";
import { useRouter } from "../router.js";
import { useSession } from "../session.js";
import { PageHead } from "../shell.js";
import { Alert, CodeBlock, CopyButton, Empty, Icon, Modal, SkeletonRows, Spinner, formatDate, timeAgo, useToast } from "../ui.js";

export function KeysPage() {
  const { active, refresh: refreshProjects } = useProjects();
  const { config } = useSession();
  const { search } = useRouter();
  const toast = useToast();
  const projectId = active!.id;
  const [keys, setKeys] = useState<ApiKeyView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(search.get("nouveau") === "1");
  const [created, setCreated] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyView | null>(null);
  const [reveal, setReveal] = useState(false);
  const [sim, setSim] = useState<SimulatorSummary | null>(null);
  const sessionKey = rememberedKey(projectId);

  const load = useCallback(() => {
    api<ProjectDetail>(`/api/projects/${projectId}`)
      .then((d) => setKeys(d.keys))
      .catch((err) => setError(errorMessage(err)));
  }, [projectId]);

  useEffect(() => {
    setKeys(null);
    load();
    api<{ simulators: SimulatorSummary[] }>("/api/simulators?kind=http")
      .then((r) => setSim(r.simulators.find((s) => isExecutable(s) && s.endpoints.some((e) => e.method === "POST")) ?? null))
      .catch(() => setSim(null));
  }, [load]);

  async function revoke(k: ApiKeyView) {
    try {
      await api(`/api/projects/${projectId}/keys/${k.id}`, { method: "DELETE" });
      toast("Clé révoquée : elle est refusée immédiatement");
      load();
      void refreshProjects();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRevoking(null);
    }
  }

  const activeKeys = keys?.filter((k) => !k.revokedAt) ?? [];
  const endpoint = sim?.endpoints.find((e) => e.method === "POST");
  const shownKey = sessionKey ? (reveal ? sessionKey : `${sessionKey.slice(0, 12)}${"•".repeat(24)}${sessionKey.slice(-4)}`) : "sk_test_VOTRE_CLE";
  const curl = sim && endpoint ? `curl -X POST ${config?.engineUrl ?? ""}/${sim.slug}${endpoint.path} \\\n  -H "Authorization: Bearer ${shownKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"amount": 5000, "merchant": "Ma boutique"}'` : null;

  return (
    <>
      <PageHead
        title="Clés API"
        description="Votre app s'authentifie auprès des simulateurs avec une clé sk_test_…. Seule son empreinte est conservée : la clé complète n'est affichée qu'une fois."
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Nouvelle clé
          </button>
        }
      />
      {error && <Alert>{error}</Alert>}
      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="panel-head">
          <h2>Clés de test</h2>
          <span className="badge">{activeKeys.length} active{activeKeys.length > 1 ? "s" : ""}</span>
        </div>
        {!keys ? (
          <SkeletonRows rows={2} />
        ) : keys.length === 0 ? (
          <Empty icon="key" title="Aucune clé" action={<button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" /> Créer une clé</button>}>
            Créez une clé pour appeler les simulateurs depuis votre application ou la console.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th className="hide-sm">Clé</th>
                  <th className="hide-sm">Créée</th>
                  <th className="hide-sm">Dernière utilisation</th>
                  <th>État</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} style={k.revokedAt ? { opacity: 0.6 } : undefined}>
                    <td>
                      <div>{k.name ?? <span className="muted">Sans nom</span>}</div>
                      <div className="mono xs muted show-sm">{k.display}</div>
                    </td>
                    <td className="mono small hide-sm">{k.display}</td>
                    <td className="hide-sm small muted">{formatDate(k.createdAt)}</td>
                    <td className="hide-sm small muted">{timeAgo(k.lastUsedAt)}</td>
                    <td>
                      {k.revokedAt ? (
                        <span className="badge badge-err"><span className="dot" /> Révoquée</span>
                      ) : (
                        <span className="badge badge-ok"><span className="dot" /> Active</span>
                      )}
                    </td>
                    <td className="num">
                      {!k.revokedAt && (
                        <button className="btn btn-danger btn-sm" onClick={() => setRevoking(k)} aria-label={`Révoquer ${k.name ?? k.display}`}>
                          <Icon name="trash" /> <span className="hide-xs">Révoquer</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Démarrage rapide</h2>
            <p className="small muted" style={{ marginTop: "0.2rem" }}>
              {sessionKey
                ? "Clé de cet onglet incluse (masquée par défaut)."
                : activeKeys.length > 0
                  ? "Remplacez sk_test_VOTRE_CLE par votre clé : elle n'est plus affichable après sa création."
                  : "Créez une clé : elle sera reprise ici pour cet onglet."}
            </p>
          </div>
          {sessionKey && (
            <div className="row">
              <button className="btn btn-sm" onClick={() => setReveal((v) => !v)} aria-pressed={reveal}>
                <Icon name={reveal ? "eyeOff" : "eye"} /> {reveal ? "Masquer" : "Afficher"}
              </button>
              <CopyButton value={sessionKey} label="Copier la clé" />
            </div>
          )}
        </div>
        <div className="panel-body">
          {curl ? <CodeBlock code={curl} title="cURL" /> : <p className="muted small">Aucun simulateur HTTP publié pour l'instant.</p>}
        </div>
      </div>

      {creating && (
        <CreateKey
          projectId={projectId}
          onClose={() => setCreating(false)}
          onCreated={(key) => {
            setCreating(false);
            setCreated(key);
            load();
            void refreshProjects();
          }}
        />
      )}
      {created && (
        <Modal
          title="Votre nouvelle clé de test"
          onClose={() => setCreated(null)}
          footer={
            <>
              <CopyButton value={created} label="Copier la clé" small={false} />
              <button className="btn btn-primary" onClick={() => setCreated(null)}>
                J'ai copié ma clé
              </button>
            </>
          }
        >
          <div className="stack">
            <Alert kind="warn">
              <strong>Copiez-la maintenant.</strong> Pour votre sécurité, elle ne sera plus jamais affichée en entier.
            </Alert>
            <div className="secret-box">{created}</div>
            <p className="xs muted">Elle reste utilisable dans la console et la boutique démo de cet onglet jusqu'à la déconnexion.</p>
          </div>
        </Modal>
      )}
      {revoking && (
        <Modal
          title="Révoquer cette clé ?"
          onClose={() => setRevoking(null)}
          footer={
            <>
              <button className="btn" onClick={() => setRevoking(null)}>
                Annuler
              </button>
              <button className="btn btn-danger-solid" onClick={() => revoke(revoking)}>
                Révoquer définitivement
              </button>
            </>
          }
        >
          <p className="text-2">
            Les appels signés avec <code>{revoking.display}</code> seront refusés immédiatement (401). Cette action est irréversible.
          </p>
        </Modal>
      )}
    </>
  );
}

function CreateKey({ projectId, onClose, onCreated }: { projectId: string; onClose: () => void; onCreated: (key: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ key: string }>(`/api/projects/${projectId}/keys`, { body: { name: name.trim() || undefined } });
      rememberKey(projectId, r.key);
      onCreated(r.key);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Nouvelle clé de test"
      description="Donnez-lui un nom pour la reconnaître (ex. : serveur de dev, CI)."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => submit()}>
            {busy ? <Spinner /> : "Créer la clé"}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="stack">
        <div className="field">
          <label className="label" htmlFor="kname">
            Nom <span className="muted">(facultatif)</span>
          </label>
          <input id="kname" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus placeholder="Serveur de développement" />
        </div>
        {error && <Alert>{error}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
