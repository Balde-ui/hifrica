import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, errorMessage } from "../api.js";
import { findProblems } from "../editor/yamlProblems.js";
import { YamlEditor, type YamlEditorHandle } from "../editor/YamlEditor.js";
import { Link, useRouter } from "../router.js";
import { useSession } from "../session.js";
import { Alert, Modal, Spinner, useToast } from "../ui.js";

const DRAFT_KEY = "hifrica:editor-draft";

/** Modèle de départ : même structure que l'exemple officiel du dépôt (simulators/paiement-mobile-generique.yaml). */
const TEMPLATE = `name: mon-simulateur
version: 1.0.0
description: Décrivez ici le service simulé (aucune marque réelle).
kind: http
auth: bearer
endpoints:
  - id: create
    method: POST
    path: /v1/payments
    response:
      status: 201
      body: { id: "{{uuid}}", status: "pending", amount: "{{body.amount}}", currency: "XOF" }
  - id: status
    method: GET
    path: /v1/payments/{id}
    response:
      status: 200
      body: { id: "{{params.id}}", status: "pending" }
scenarios:
  solde-insuffisant:
    endpoint: create
    match: { body.amount: "> 500000" }
    response: { status: 402, body: { error: "insufficient_funds" } }
`;

function loadDraft(): string | null {
  try {
    return localStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

export function EditorPage() {
  const { search } = useRouter();
  const { user } = useSession();
  const toast = useToast();
  const forkOf = search.get("fork");
  const [yaml, setYaml] = useState<string>(() => (forkOf ? "" : loadDraft() ?? TEMPLATE));
  const [origin, setOrigin] = useState<"manual" | "ai">("manual");
  const [loadingFork, setLoadingFork] = useState(Boolean(forkOf));
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ slug: string; version: string } | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const handle = useRef<YamlEditorHandle | null>(null);

  // Fork : on part du YAML publié, avec un nouveau nom à choisir.
  useEffect(() => {
    if (!forkOf) return;
    api<{ simulator: { yaml: string } }>(`/api/simulators/${encodeURIComponent(forkOf)}`)
      .then((r) => {
        const renamed = r.simulator.yaml.replace(/^name:\s*.+$/m, `name: ${forkOf}-fork`).replace(/^version:\s*.+$/m, "version: 1.0.0");
        setYaml(renamed);
        toast(`Fork de ${forkOf} : changez « name » avant de publier`);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoadingFork(false));
  }, [forkOf, toast]);

  // Brouillon conservé dans ce navigateur (confort uniquement).
  useEffect(() => {
    if (!yaml) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, yaml);
      } catch {
        /* stockage indisponible */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [yaml]);

  const check = useMemo(() => findProblems(yaml), [yaml]);
  const meta = (check.simulator ?? {}) as { name?: string; version?: string; kind?: string };

  async function publish() {
    setError(null);
    setPublished(null);
    setPublishing(true);
    try {
      const r = await api<{ slug: string; version: string }>("/api/simulators", { body: { yaml, origin, ...(forkOf ? { forkOf } : {}) } });
      setPublished(r);
      toast("Simulateur publié");
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setError("Le serveur a refusé le YAML : corrigez les erreurs signalées.");
      else setError(errorMessage(err));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <>
      <div className="page-head" style={{ marginBottom: "0.75rem" }}>
        <div>
          <h1>Éditeur de simulateur</h1>
          <p>YAML validé en direct contre le schéma partagé, celui qu'utilisent aussi l'API, le moteur et l'assistant IA.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setAiOpen(true)}>
            ✨ Générer avec l'IA
          </button>
          <button
            className="btn"
            onClick={() => {
              setYaml(TEMPLATE);
              setOrigin("manual");
            }}
          >
            Modèle de départ
          </button>
          {user ? (
            <button className="btn btn-primary" disabled={!check.valid || publishing} onClick={publish} title={check.valid ? "" : "Corrigez les erreurs avant de publier"}>
              {publishing ? <Spinner /> : "Publier"}
            </button>
          ) : (
            <Link to="/connexion?suite=/editeur" className="btn btn-primary">
              Se connecter pour publier
            </Link>
          )}
        </div>
      </div>
      <div className="editor-layout">
        {loadingFork ? (
          <div className="editor-host" style={{ display: "grid", placeItems: "center" }}>
            <Spinner />
          </div>
        ) : (
          <YamlEditor value={yaml} onChange={setYaml} problems={check.problems} onReady={(h) => (handle.current = h)} />
        )}
        <aside className="side-panel">
          <div className="card">
            <div className="spread">
              <h3 style={{ margin: 0 }}>Validation</h3>
              {check.valid ? <span className="badge badge-ok">✓ Valide</span> : <span className="badge badge-err">{check.problems.length} erreur{check.problems.length > 1 ? "s" : ""}</span>}
            </div>
            {check.valid ? (
              <dl className="kv" style={{ marginTop: "0.6rem" }}>
                <dt>Nom</dt>
                <dd className="mono">{meta.name}</dd>
                <dt>Version</dt>
                <dd>{meta.version}</dd>
                <dt>Type</dt>
                <dd>{meta.kind === "ussd" ? "USSD" : "API HTTP"}</dd>
              </dl>
            ) : (
              <ul className="problems" style={{ marginTop: "0.5rem" }}>
                {check.problems.map((p, i) => (
                  <li key={i} onClick={() => handle.current?.revealLine(p.line)}>
                    <span className="line">L{p.line}</span>
                    <span>{p.message}</span>
                  </li>
                ))}
              </ul>
            )}
            {origin === "ai" && (
              <Alert kind="warn">
                <strong>Généré par IA, à vérifier.</strong> Relisez chaque endpoint et scénario : le modèle peut inventer le format d'une vraie API.
              </Alert>
            )}
          </div>
          {error && <Alert>{error}</Alert>}
          {published && (
            <Alert kind="ok">
              <strong>
                {published.slug} {published.version}
              </strong>{" "}
              est publié. <Link to={`/catalogue/${published.slug}`}>Voir sa page</Link> ou testez-le depuis la console d'un{" "}
              <Link to="/app">projet</Link>.
            </Alert>
          )}
          <div className="card small">
            <h3>Aide-mémoire</h3>
            <ul style={{ paddingLeft: "1.1rem", margin: 0 }} className="muted">
              <li><code>name</code> en kebab-case, unique dans le catalogue.</li>
              <li>Augmentez <code>version</code> pour republier.</li>
              <li>Gabarits : <code>{"{{uuid}}"}</code>, <code>{"{{now}}"}</code>, <code>{"{{body.champ}}"}</code>, <code>{"{{params.id}}"}</code>.</li>
              <li>Prévoyez au moins un scénario d'échec dans <code>scenarios</code>.</li>
              <li>Jamais de vraie marque, URL, clé ou donnée personnelle.</li>
            </ul>
          </div>
        </aside>
      </div>
      {aiOpen && (
        <AiPanel
          onClose={() => setAiOpen(false)}
          onGenerated={(generated) => {
            setYaml(generated);
            setOrigin("ai");
            setAiOpen(false);
          }}
        />
      )}
    </>
  );
}

const AI_ERRORS: Record<string, string> = {
  ai_disabled: "L'assistant IA est désactivé sur ce serveur (AI_GENERATION_ENABLED).",
  ai_unavailable: "Aucun fournisseur d'IA n'est disponible pour le moment.",
  ai_timeout: "La génération a pris trop de temps : réessayez avec une description plus courte.",
  quota_exceeded: "Quota de générations atteint pour l'heure : réessayez plus tard.",
  daily_limit_reached: "Le plafond quotidien de générations est atteint : réessayez demain.",
};

function AiPanel({ onClose, onGenerated }: { onClose: () => void; onGenerated: (yaml: string) => void }) {
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"" | "http" | "ussd">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ yaml: string }>("/api/simulators/generate", { body: { description, ...(kind ? { kind } : {}) } });
      onGenerated(r.yaml);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        // YAML encore invalide après les corrections : on l'ouvre quand même, erreurs soulignées.
        const d = err.details as { yaml?: string };
        if (d?.yaml) return onGenerated(d.yaml);
      }
      setError((err instanceof ApiError && AI_ERRORS[err.code]) || errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Générer un simulateur avec l'IA" onClose={onClose}>
      <div className="stack">
        <p className="muted small">
          Décrivez le service en français : endpoints, réponses et scénarios d'échec. Ne saisissez aucune donnée personnelle ni
          secret : la description est envoyée à un fournisseur d'IA (masquage partiel, voir AI_USAGE.md).
        </p>
        <textarea
          className="input"
          style={{ fontFamily: "var(--font)", fontSize: "0.95rem" }}
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ex. : une API de transfert d'argent entre deux numéros, avec un scénario « numéro inconnu » et un scénario « plafond dépassé »."
          maxLength={2000}
        />
        <div className="row">
          <select className="input" style={{ width: 200 }} value={kind} onChange={(e) => setKind(e.target.value as "" | "http" | "ussd")} aria-label="Type">
            <option value="">Type : au choix de l'IA</option>
            <option value="http">API HTTP</option>
            <option value="ussd">Menu USSD</option>
          </select>
          <span className="small muted">{description.trim().length}/2000</span>
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={busy || description.trim().length < 10} onClick={generate}>
            {busy ? (
              <>
                <Spinner /> Génération…
              </>
            ) : (
              "Générer"
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
