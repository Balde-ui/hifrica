// Illustrations animées des cartes de l'accueil (dans l'esprit des cartes « bento » de supabase.com),
// dessinées pour Hifrica : uniquement des concepts du produit (format YAML, clés, scénarios, console…),
// aucune donnée présentée comme réelle. Animations CSS, coupées si prefers-reduced-motion.
import { Icon } from "../ui.js";

/** Catalogue : rangées de clés YAML qui défilent en sens alternés. */
export function CatalogueArt() {
  const rows = [
    ["kind: http", "auth: bearer", "endpoints:", "version: 1.0.0", "webhook:", "phone:"],
    ["kind: ussd", "code: *123#", "menus:", "start:", "text:", "on:"],
    ["scenarios:", "solde-insuffisant", "timeout", "match:", "delay: 30s", "status: 402"],
    ["response:", "status: 201", "body:", "{{uuid}}", "{{body.amount}}", "currency: XOF"],
    ["license: CC-BY-4.0", "fork", "version: 1.0.1", "origin: ai", "verified", "description:"],
  ];
  return (
    <div className="art art-marquee" aria-hidden="true">
      {rows.map((row, i) => (
        <div key={i} className={`marquee-row ${i % 2 ? "rev" : ""}`} style={{ animationDuration: `${26 + i * 6}s` }}>
          {[...row, ...row].map((label, j) => (
            <span key={j} className="art-pill">
              <span className="art-dot" style={{ background: j % 3 === 0 ? "var(--accent)" : "var(--border-strong)" }} />
              {label}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Clés : clés masquées, scintillement des caractères cachés, état actif / révoqué, copie. */
export function KeysArt() {
  return (
    <div className="art art-keys" aria-hidden="true">
      {[
        ["X2n6", "mi22", "active"],
        ["q8Lp", "0vKa", "révoquée"],
        ["Tz41", "Hb7c", "active"],
      ].map(([a, b, state], i) => (
        <div key={i} className="key-row" style={{ animationDelay: `${i * 0.6}s` }}>
          <Icon name="key" size={13} />
          <span className="mono">
            sk_test_{a}
            <span className="key-mask">••••••••</span>
            {b}
          </span>
          <span className={state === "active" ? "key-state ok" : "key-state off"}>{state}</span>
        </div>
      ))}
      <span className="art-toast">
        <Icon name="check" size={12} /> Affichée une seule fois
      </span>
    </div>
  );
}

/** Scénarios : le sélecteur glisse entre « Nominal » et « Solde insuffisant », le statut suit. */
export function ScenarioArt() {
  return (
    <div className="art art-scenario" aria-hidden="true">
      <div className="switch">
        <span className="switch-thumb" />
        <span className="switch-a">Nominal</span>
        <span className="switch-b">Solde insuffisant</span>
      </div>
      <div className="scenario-out mono">
        POST /checkout →{" "}
        <span className="code-swap">
          <span className="c201">201</span>
          <span className="c402">402</span>
        </span>
      </div>
    </div>
  );
}

/** Console : flux continu de requêtes journalisées. */
export function ConsoleArt() {
  const lines: [number, string, string, string][] = [
    [201, "POST", "/v1/checkout", "24 ms"],
    [402, "POST", "/v1/checkout", "9 ms"],
    [200, "GET", "/v1/checkout/{id}", "7 ms"],
    [401, "POST", "/v1/checkout", "3 ms"],
    [201, "POST", "/v1/checkout", "18 ms"],
    [200, "GET", "/v1/checkout/{id}", "6 ms"],
  ];
  return (
    <div className="art art-console" aria-hidden="true">
      <div className="console-track">
        {[...lines, ...lines].map(([s, m, p, d], i) => (
          <div key={i} className="console-line">
            <span className={`status-code s${String(s)[0]}`}>{s}</span>
            <span className={`method method-${m}`}>{m}</span>
            <span className="mono truncate">{p}</span>
            <span className="muted">{d}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Éditeur : une erreur apparaît (soulignée en rouge), puis est corrigée ; l'état du schéma suit. */
export function EditorArt() {
  return (
    <div className="art art-editor mono" aria-hidden="true">
      <div className="ed-line"><span className="ln">1</span><span className="tok-key">name</span>: <span className="tok-str">mon-simulateur</span></div>
      <div className="ed-line"><span className="ln">2</span><span className="tok-key">endpoints</span>:</div>
      <div className="ed-line"><span className="ln">3</span>  - <span className="tok-key">method</span>: <span className="ed-swap"><span className="bad">ENVOYER</span><span className="good tok-str">POST</span></span><span className="caret" /></div>
      <div className="ed-line"><span className="ln">4</span>    <span className="tok-key">path</span>: <span className="tok-str">/v1/payments</span></div>
      <div className="ed-status">
        <span className="ed-err">● 1 erreur</span>
        <span className="ed-ok">● schéma OK</span>
      </div>
    </div>
  );
}

/** Assistant IA : la description s'écrit, puis le YAML validé apparaît. */
export function AiArt() {
  return (
    <div className="art art-ai" aria-hidden="true">
      <div className="ai-prompt">
        <Icon name="sparkles" size={14} />
        <span className="ai-typed mono">une API de transfert avec un plafond</span>
      </div>
      <div className="ai-arrow">↓</div>
      <div className="ai-result mono">
        <span className="tok-key">scenarios</span>: <span className="tok-str">plafond-depasse</span> → <span className="s4 status-code">402</span>
        <span className="badge badge-ok" style={{ marginLeft: "0.6rem" }}>
          <Icon name="check" size={11} /> validé
        </span>
      </div>
    </div>
  );
}

/** Sécurité : radar autour d'un bouclier, points qui apparaissent (requêtes inspectées). */
export function SecurityArt() {
  return (
    <div className="art art-radar" aria-hidden="true">
      <svg viewBox="0 0 220 220" className="radar">
        {[30, 55, 80, 105].map((r) => (
          <circle key={r} cx="110" cy="110" r={r} fill="none" stroke="var(--border-strong)" strokeDasharray={r % 50 === 5 ? "3 5" : undefined} />
        ))}
        <line x1="110" y1="5" x2="110" y2="215" stroke="var(--border)" />
        <line x1="5" y1="110" x2="215" y2="110" stroke="var(--border)" />
        <g className="radar-sweep">
          <path d="M110 110 L110 5 A105 105 0 0 1 200 58 Z" fill="url(#sweep)" />
        </g>
        <defs>
          <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="rgba(62,207,142,0.35)" />
            <stop offset="1" stopColor="rgba(62,207,142,0)" />
          </linearGradient>
        </defs>
        {[
          [160, 70, 0],
          [62, 150, 1.2],
          [150, 165, 2.1],
          [70, 72, 3],
        ].map(([x, y, d], i) => (
          <circle key={i} cx={x} cy={y} r="3.5" className="radar-dot" style={{ animationDelay: `${d}s` }} />
        ))}
      </svg>
      <span className="radar-shield">
        <Icon name="shield" size={22} />
      </span>
    </div>
  );
}
