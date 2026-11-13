// App de démonstration « Boutique Awa » (tâche C) : une boutique fictive qui encaisse via le simulateur
// « paiement mobile générique ». Chaque paiement est un VRAI appel au moteur avec une vraie clé de test,
// visible ensuite dans la console. Présentée dans un cadre de navigateur : c'est l'app d'un développeur.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage, rememberKey, rememberedKey, type ProjectDetail, type SendResult } from "../api.js";
import { SimulatedPhone } from "../phone/SimulatedPhone.js";
import { useProjects } from "../projects.js";
import { Link } from "../router.js";
import { PageHead } from "../shell.js";
import { Alert, Empty, Icon, JsonView, Skeleton, Spinner, StatusCode, useToast } from "../ui.js";

const SIMULATOR = "paiement-mobile-generique";
const SCENARIO = "solde-insuffisant";
const USSD_SIMULATOR = "mobile-money-ussd";
const USSD_CODE = "*123#";
const OTP_SIMULATOR = "otp-sms";
const DEFAULT_PHONE = "+221770000000";

const PRODUCTS = [
  { id: "pagne", name: "Pagne wax 6 yards", price: 15000, emoji: "🧵", bg: "#f6efe4" },
  { id: "cafe", name: "Café moulu, 1 kg", price: 4500, emoji: "☕", bg: "#efe8e1" },
  { id: "sac", name: "Sac en cuir artisanal", price: 32000, emoji: "👜", bg: "#f3ece6" },
  { id: "groupe", name: "Groupe électrogène (pro)", price: 650000, emoji: "⚡", bg: "#eef1ea" },
];

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

export function DemoShop() {
  const { projects, active, select } = useProjects();
  const toast = useToast();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [key, setKey] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({ pagne: 1, cafe: 2 });
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [phone, setPhone] = useState(DEFAULT_PHONE);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  // La clé saisie n'est remplacée que si l'utilisateur change réellement de projet (pas au premier
  // chargement de la liste, sinon une clé tapée rapidement serait effacée).
  const lastProject = useRef<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const remembered = rememberedKey(active.id);
    setKey((current) => (lastProject.current !== null && lastProject.current !== active.id ? remembered : remembered || current));
    lastProject.current = active.id;
    setResult(null);
    setDetail(null);
    setOtpSent(false);
    setOtpError(null);
    api<ProjectDetail>(`/api/projects/${active.id}`)
      .then(setDetail)
      .catch((err) => setError(errorMessage(err)));
  }, [active]);

  const total = useMemo(() => PRODUCTS.reduce((sum, p) => sum + p.price * (cart[p.id] ?? 0), 0), [cart]);
  const items = PRODUCTS.filter((p) => (cart[p.id] ?? 0) > 0);
  const scenario = detail?.scenarios[SIMULATOR] ?? null;
  const hasKey = Boolean(detail?.keys.some((k) => !k.revokedAt));

  async function pay() {
    if (!active) return;
    setPaying(true);
    setError(null);
    setResult(null);
    try {
      const r = await api<SendResult>(`/api/projects/${active.id}/send`, {
        body: { key: key.trim(), simulator: SIMULATOR, method: "POST", path: "/v1/checkout", body: { amount: total, merchant: "Boutique Awa" } },
      });
      rememberKey(active.id, key.trim());
      setResult(r);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPaying(false);
    }
  }

  async function sendOtp() {
    if (!active || !phone.trim()) return;
    setSendingOtp(true);
    setOtpError(null);
    setOtpSent(false);
    try {
      const r = await api<SendResult>(`/api/projects/${active.id}/send`, {
        body: { key: key.trim(), simulator: OTP_SIMULATOR, method: "POST", path: "/v1/otp", body: { phone: phone.trim() } },
      });
      rememberKey(active.id, key.trim());
      if (r.status < 200 || r.status >= 300) setOtpError(`Erreur ${r.status} du simulateur.`);
      else setOtpSent(true);
    } catch (err) {
      setOtpError(errorMessage(err));
    } finally {
      setSendingOtp(false);
    }
  }

  async function setScenario(next: string | null) {
    if (!active) return;
    setSwitching(true);
    try {
      await api(`/api/projects/${active.id}/scenario`, { method: "PUT", body: { simulator: SIMULATOR, scenario: next } });
      setDetail((d) => (d ? { ...d, scenarios: { ...d.scenarios, [SIMULATOR]: next } } : d));
      toast(next ? "Scénario « solde insuffisant » activé" : "Paiements acceptés (scénario nominal)");
      setResult(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSwitching(false);
    }
  }

  if (projects && projects.length === 0) {
    return (
      <div className="panel">
        <Empty icon="cart" title="La boutique a besoin d'un projet" action={<Link to="/app/projets?nouveau=1" className="btn btn-primary">Créer un projet</Link>}>
          Elle encaisse ses paiements avec la clé de test de votre projet Hifrica.
        </Empty>
      </div>
    );
  }

  const outcome = result ? interpret(result) : null;
  const qty = (id: string, delta: number) => setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(9, (c[id] ?? 0) + delta)) }));

  return (
    <>
      <PageHead
        title="Boutique démo"
        description="L'app d'un marchand fictif intègre le paiement mobile via Hifrica. Chaque paiement est un vrai appel au simulateur, visible dans la console."
        actions={
          <Link to="/app/console" className="btn">
            <Icon name="terminal" /> Voir la console
          </Link>
        }
      />
      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="panel-body">
          <div className="grid cols-3" style={{ alignItems: "end" }}>
            <div className="field">
              <label className="label" htmlFor="dproj">Projet Hifrica de la boutique</label>
              <select id="dproj" className="input" value={active?.id ?? ""} onChange={(e) => select(e.target.value)}>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="dkey">Clé de test utilisée par la boutique</label>
              <input id="dkey" className="input mono" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk_test_…" autoComplete="off" spellCheck={false} />
            </div>
            <div className="field">
              <span className="label">Comportement du simulateur</span>
              <div className="segmented" role="radiogroup" aria-label="Scénario">
                <button role="radio" aria-checked={scenario === null} className={scenario === null ? "on" : ""} disabled={switching || !detail} onClick={() => scenario !== null && setScenario(null)}>
                  Paiement accepté
                </button>
                <button role="radio" aria-checked={scenario === SCENARIO} className={scenario === SCENARIO ? "on" : ""} disabled={switching || !detail} onClick={() => scenario !== SCENARIO && setScenario(SCENARIO)}>
                  Solde insuffisant
                </button>
              </div>
            </div>
          </div>
          {detail && !hasKey && (
            <div style={{ marginTop: "0.9rem" }}>
              <Alert kind="warn">
                Ce projet n'a pas de clé active. <Link to="/app/cles?nouveau=1">Créez une clé</Link> : elle sera reprise ici automatiquement.
              </Alert>
            </div>
          )}
          {detail && hasKey && !key && (
            <div style={{ marginTop: "0.9rem" }}>
              <Alert kind="info">Collez la clé de test du projet (affichée une seule fois à sa création), ou créez-en une nouvelle dans <Link to="/app/cles">Clés API</Link>.</Alert>
            </div>
          )}
          {error && <div style={{ marginTop: "0.9rem" }}><Alert>{error}</Alert></div>}
        </div>
      </div>

      <div className="row-nw" style={{ gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div className="browser" style={{ flex: "1 1 480px", minWidth: 0 }}>
          <div className="browser-bar">
            <div className="browser-dots"><span /><span /><span /></div>
            <div className="browser-url">
              <Icon name="shield" size={12} /> &nbsp;boutique-awa.exemple/panier
            </div>
          </div>
          <div className="shop">
            <div className="shop-head">
              <div className="shop-logo"><span>A</span> Boutique Awa</div>
              <span style={{ fontSize: "0.82rem", color: "#5b616a" }}>{items.reduce((n, p) => n + (cart[p.id] ?? 0), 0)} article(s)</span>
            </div>
            <div className="shop-body">
              <div className="products">
                {PRODUCTS.map((p) => (
                  <div key={p.id} className="product">
                    <div className="product-visual" style={{ background: p.bg }} aria-hidden="true">{p.emoji}</div>
                    <div className="product-info">
                      <span className="product-name">{p.name}</span>
                      <span className="product-price">{fcfa(p.price)}</span>
                      <div className="qty" role="group" aria-label={`Quantité de ${p.name}`}>
                        <button aria-label={`Retirer ${p.name}`} onClick={() => qty(p.id, -1)}>−</button>
                        <span>{cart[p.id] ?? 0}</span>
                        <button aria-label={`Ajouter ${p.name}`} onClick={() => qty(p.id, 1)}>+</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="checkout">
                <h3>Récapitulatif</h3>
                <div className="field" style={{ marginTop: "0.4rem" }}>
                  <label className="label" htmlFor="dphone">Vérifier le numéro du client (SMS)</label>
                  <div className="row" style={{ gap: "0.4rem" }}>
                    <input
                      id="dphone"
                      className="input mono"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+221770000000"
                      autoComplete="off"
                      style={{ flex: 1 }}
                    />
                    <button className="btn btn-sm" disabled={sendingOtp || !phone.trim() || !key.trim() || !active} onClick={() => void sendOtp()}>
                      {sendingOtp ? <Spinner /> : "Recevoir un code"}
                    </button>
                  </div>
                  {otpSent && <p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.3rem" }}>Code envoyé : consultez le SMS reçu sur le téléphone simulé.</p>}
                  {otpError && <p style={{ fontSize: "0.72rem", marginTop: "0.3rem", color: "#c0392b" }}>{otpError}</p>}
                </div>
                <div style={{ marginTop: "0.6rem" }}>
                  {items.length === 0 ? (
                    <p style={{ fontSize: "0.84rem", color: "#5b616a" }}>Votre panier est vide.</p>
                  ) : (
                    items.map((p) => (
                      <div key={p.id} className="line">
                        <span>{cart[p.id]} × {p.name}</span>
                        <span>{fcfa(p.price * (cart[p.id] ?? 0))}</span>
                      </div>
                    ))
                  )}
                  <div className="line"><span>Livraison</span><span>Offerte</span></div>
                  <div className="line total"><span>Total</span><span>{fcfa(total)}</span></div>
                </div>
                <button className="pay-btn" disabled={paying || total === 0 || !key.trim() || !active} onClick={pay} aria-label={`Payer par mobile money ${fcfa(total)}`}>
                  {paying ? <><Spinner /> Paiement en cours…</> : <><span className="hide-xs">Payer par mobile money ·&nbsp;</span><span className="show-xs">Payer&nbsp;</span>{fcfa(total)}</>}
                </button>
                {outcome && (
                  <div className={`pay-result ${outcome.cls}`} role="status">
                    <strong>{outcome.title}</strong>
                    <div style={{ marginTop: "0.2rem" }}>{outcome.text}</div>
                  </div>
                )}
                <p style={{ fontSize: "0.72rem", color: "#8a8f96", marginTop: "0.8rem" }}>
                  Démo : avec « Solde insuffisant », les paniers de plus de 500 000 FCFA sont refusés (ajoutez le groupe électrogène).
                </p>
              </div>
            </div>
          </div>
        </div>

        {active && (
          <SimulatedPhone projectId={active.id} testKey={key.trim()} ussdSimulator={USSD_SIMULATOR} ussdCode={USSD_CODE} />
        )}
      </div>

      {(result || paying) && (
        <div className="panel" style={{ marginTop: "1rem" }}>
          <div className="panel-head">
            <h2>Ce que l'app de la boutique a reçu</h2>
            {result && (
              <span className="row small muted">
                <StatusCode status={result.status} /> · {result.durationMs} ms
              </span>
            )}
          </div>
          <div className="panel-body">
            {paying || !result ? <Skeleton h={80} /> : <JsonView title={`POST /${SIMULATOR}/v1/checkout`} value={result.body} />}
          </div>
        </div>
      )}
    </>
  );
}

function interpret(r: SendResult): { cls: string; title: string; text: string } {
  const body = (r.body ?? {}) as { status?: string; error?: string };
  if (r.status === 201 || r.status === 200) {
    return { cls: "pay-ok", title: "Paiement initié ✓", text: `Statut « ${body.status ?? "pending"} » : le client valide sur son téléphone, puis la boutique reçoit un webhook signé.` };
  }
  if (r.status === 402) {
    return { cls: "pay-ko", title: "Paiement refusé : solde insuffisant", text: "La boutique affiche l'échec et propose un autre moyen de paiement, sans planter." };
  }
  if (r.status === 401) return { cls: "pay-err", title: "Clé refusée", text: "La clé de test est invalide ou révoquée." };
  return { cls: "pay-err", title: `Erreur ${r.status}`, text: body.error ?? "Réponse inattendue du simulateur." };
}
