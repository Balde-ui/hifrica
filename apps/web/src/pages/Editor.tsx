import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, errorMessage } from "../api.js";
import { findProblems } from "../editor/yamlProblems.js";
import { YamlEditor, type YamlEditorHandle } from "../editor/YamlEditor.js";
import { Link, useRouter } from "../router.js";
import { useSession } from "../session.js";
import { Alert, Icon, Modal, Spinner, useToast } from "../ui.js";

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
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const handle = useRef<YamlEditorHandle | null>(null);
  const forkToast = useRef(false);

  // Fork : on part du YAML publié, avec un nouveau nom à choisir.
  useEffect(() => {
    if (!forkOf) return;
    api<{ simulator: { yaml: string } }>(`/api/simulators/${encodeURIComponent(forkOf)}`)
      .then((r) => {
        setYaml(r.simulator.yaml.replace(/^name:\s*.+$/m, `name: ${forkOf}-fork`).replace(/^version:\s*.+$/m, "version: 1.0.0"));
        if (!forkToast.current) toast(`Fork de ${forkOf} : changez « name » avant de publier`);
        forkToast.current = true;
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
  const meta = (check.simulator ?? {}) as { name?: string; version?: string; kind?: string; endpoints?: unknown[]; scenarios?: object; menus?: object };
  const fileName = `${meta.name ?? (yaml.match(/^name:\s*([\w-]+)/m)?.[1] || "simulateur")}.yaml`;
  const lines = yaml.split("\n").length;

  async function publish() {
    setError(null);
    setPublished(null);
    setPublishing(true);
    try {
      const r = await api<{ slug: string; version: string }>("/api/simulators", { body: { yaml, origin, ...(forkOf ? { forkOf } : {}) } });
      setPublished(r);
      toast("Simulateur publié dans le catalogue sous licence CC BY 4.0");
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setError("Le serveur a refusé le YAML : corrigez les erreurs signalées.");
      else setError(errorMessage(err));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <>
      <div className="ide">
        <div className="ide-main">
          <div className="ide-bar">
            <span className="ide-file">
              <Icon name="file" /> {fileName}
            </span>
            {check.valid ? (
              <span className="badge badge-ok"><Icon name="checkCircle" size={12} /> Valide</span>
            ) : (
              <span className="badge badge-err"><Icon name="xCircle" size={12} /> {check.problems.length} erreur{check.problems.length > 1 ? "s" : ""}</span>
            )}
            {origin === "ai" && <span className="badge badge-warn"><Icon name="sparkles" size={12} /> Généré par IA, à vérifier</span>}
            <div className="row" style={{ marginLeft: "auto" }}>
              <button className="btn btn-sm" onClick={() => setAiOpen(true)}>
                <Icon name="sparkles" /> <span className="hide-xs">Générer avec l'IA</span>
              </button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  setYaml(TEMPLATE);
                  setOrigin("manual");
                }}
                title="Remplacer par le modèle de départ"
              >
                <Icon name="refresh" /> <span className="hide-xs">Modèle</span>
              </button>
              {user ? (
                <button className="btn btn-primary btn-sm" disabled={!check.valid || publishing} onClick={publish} title={check.valid ? "Publier dans le catalogue sous licence CC BY 4.0" : "Corrigez les erreurs avant de publier"}>
                  {publishing ? <Spinner /> : <><Icon name="upload" /> Publier</>}
                </button>
              ) : (
                <Link to="/connexion?suite=/editeur" className="btn btn-primary btn-sm">
                  Se connecter pour publier
                </Link>
              )}
            </div>
          </div>
          {loadingFork ? (
            <div className="editor-host" style={{ display: "grid", placeItems: "center", background: "var(--code-bg)" }}>
              <Spinner />
            </div>
          ) : (
            <YamlEditor value={yaml} onChange={setYaml} problems={check.problems} onReady={(h) => (handle.current = h)} onCursor={(line, col) => setCursor({ line, col })} />
          )}
          <div className="ide-status">
            <span>YAML</span>
            <span>
              Ln {cursor.line}, Col {cursor.col}
            </span>
            <span className="hide-xs">{lines} lignes</span>
            <span style={{ marginLeft: "auto", color: check.valid ? "var(--ok)" : "var(--err)" }}>{check.valid ? "● schéma OK" : "● schéma invalide"}</span>
          </div>
        </div>
        <aside className="ide-side">
          <div className="ide-section">
            <div className="spread">
              <span className="section-title">Problèmes</span>
              <span className={check.valid ? "badge badge-ok" : "badge badge-err"}>{check.problems.length}</span>
            </div>
            {check.valid ? (
              <p className="small muted" style={{ marginTop: "0.6rem" }}>
                Aucun problème : le YAML respecte le schéma partagé (le même que l'API, le moteur et l'assistant IA).
              </p>
            ) : (
              <ul className="problems">
                {check.problems.map((p, i) => (
                  <li key={i} onClick={() => handle.current?.revealLine(p.line)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && handle.current?.revealLine(p.line)}>
                    <Icon name="xCircle" />
                    <span className="ln">L{p.line}</span>
                    <span>{p.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {check.valid && (
            <div className="ide-section">
              <span className="section-title">Simulateur</span>
              <dl className="kv" style={{ marginTop: "0.6rem", gridTemplateColumns: "90px minmax(0,1fr)" }}>
                <dt>Nom</dt>
                <dd className="mono small">{meta.name}</dd>
                <dt>Version</dt>
                <dd>{meta.version}</dd>
                <dt>Type</dt>
                <dd>{meta.kind === "ussd" ? "USSD" : "API HTTP"}</dd>
                <dt>Contenu</dt>
                <dd>
                  {meta.kind === "ussd" ? `${Object.keys(meta.menus ?? {}).length} menu(s)` : `${meta.endpoints?.length ?? 0} endpoint(s)`}, {Object.keys(meta.scenarios ?? {}).length} scénario(s)
                </dd>
              </dl>
            </div>
          )}
          <div className="ide-section">
            <span className="section-title">Licence de publication</span>
            <p className="small muted" style={{ marginTop: "0.6rem" }}>
              <span className="badge badge-info" style={{ marginRight: "0.4rem" }}>CC BY 4.0</span>
              En publiant, vous placez ce simulateur sous licence{" "}
              <a href="https://creativecommons.org/licenses/by/4.0/deed.fr" target="_blank" rel="noreferrer">
                Creative Commons Attribution 4.0
              </a>{" "}
              : chacun peut le réutiliser et l'adapter, à condition de vous citer.
            </p>
          </div>
          {(error || published) && (
            <div className="ide-section stack-sm">
              {error && <Alert>{error}</Alert>}
              {published && (
                <Alert kind="ok">
                  <strong>
                    {published.slug} {published.version}
                  </strong>{" "}
                  est publié dans le catalogue sous licence CC BY 4.0 : réutilisable et adaptable par tous, avec attribution. <Link to={`/catalogue/${published.slug}`}>Voir sa documentation</Link>. Son exécution par le moteur arrive avec le chargement des simulateurs publiés.
                </Alert>
              )}
            </div>
          )}
          <div className="ide-section">
            <span className="section-title">Aide-mémoire</span>
            <ul className="small muted" style={{ paddingLeft: "1rem", margin: "0.6rem 0 0", lineHeight: 1.8 }}>
              <li><code>name</code> en kebab-case, unique.</li>
              <li>Augmentez <code>version</code> pour republier.</li>
              <li>Gabarits : <code>{"{{uuid}}"}</code> <code>{"{{now}}"}</code> <code>{"{{body.x}}"}</code> <code>{"{{params.id}}"}</code></li>
              <li>Au moins un scénario d'échec.</li>
              <li>Aucune vraie marque, URL, clé ni donnée personnelle.</li>
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
  // Erreurs de l'assistant réservé aux comptes connectés (PR #23) : 401 sans session, 429 quota du compte.
  auth_required: "Connectez-vous pour utiliser l'assistant.",
  user_quota_exceeded: "Quota du jour atteint. Réessayez demain.",
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
    <Modal
      title="Générer avec l'IA"
      description="Décrivez le service en français : endpoints, réponses et scénarios d'échec."
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={busy || description.trim().length < 10} onClick={generate}>
            {busy ? <><Spinner /> Génération…</> : <><Icon name="sparkles" /> Générer</>}
          </button>
        </>
      }
    >
      <div className="stack">
        <textarea
          className="input"
          style={{ fontFamily: "var(--font)", fontSize: "0.88rem" }}
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ex. : une API de transfert d'argent entre deux numéros, avec un scénario « numéro inconnu » et un scénario « plafond dépassé »."
          maxLength={2000}
          aria-label="Description du simulateur"
        />
        <div className="spread">
          <div className="segmented" role="group" aria-label="Type">
            {(
              [
                ["", "Au choix"],
                ["http", "API HTTP"],
                ["ussd", "USSD"],
              ] as ["" | "http" | "ussd", string][]
            ).map(([k, label]) => (
              <button key={k} className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {label}
              </button>
            ))}
          </div>
          <span className="xs muted">{description.trim().length}/2000</span>
        </div>
        <Alert kind="info">Ne saisissez ni donnée personnelle ni secret : la description est envoyée à un fournisseur d'IA (masquage partiel).</Alert>
        {error && <Alert>{error}</Alert>}
      </div>
    </Modal>
  );
}
