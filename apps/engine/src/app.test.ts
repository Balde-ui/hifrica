// Redirection des navigateurs (sim.<domaine> → catalogue) et non-régression des appels des programmes.
// Moteur réel (buildApp), sans base ni Valkey : la clé sk_test_ passe par le bouchon local (projet "demo").
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "./app.js";
import { appPublicUrl, isBrowserRequest } from "./browser.js";
import type { HifricaRequestContext } from "./context.js";
import { loadSimulators } from "./simulators.js";

const APP = "https://app.exemple.test";
const BROWSER = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };
const CURL = { accept: "*/*" };
const KEY = { authorization: `Bearer sk_test_${"a".repeat(43)}` };
const SIMULATORS_DIR = fileURLToPath(new URL("../../../simulators", import.meta.url));

describe("sim.<domaine> : navigateurs redirigés vers le catalogue, programmes inchangés", () => {
  let app: FastifyInstance;
  /** request.hifrica de chaque réponse, dans l'ordre (null = la route n'a rien rempli). */
  const contexts: (HifricaRequestContext | null)[] = [];

  before(async () => {
    const simulators = loadSimulators(SIMULATORS_DIR, () => undefined);
    assert.ok(simulators.has("paiement-mobile-generique") && simulators.has("mobile-money-ussd"));
    app = buildApp({ simulators, env: { APP_PUBLIC_URL: APP }, logger: false });
    app.addHook("onResponse", async (req) => void contexts.push(req.hifrica));
    await app.ready();
  });
  after(() => app.close());

  const call = async (opts: InjectOptions) => {
    const res = await app.inject(opts);
    return { res, hifrica: contexts.at(-1) };
  };

  it("navigateur sur / → 302 vers le catalogue, sans contexte Hifrica (rien dans request_logs)", async () => {
    const { res, hifrica } = await call({ method: "GET", url: "/", headers: BROWSER });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, `${APP}/catalogue`);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(hifrica, null);
  });

  it("curl (ou sans Accept) sur / → 200 JSON avec le mode d'emploi", async () => {
    for (const headers of [CURL, {}, { accept: "application/json" }]) {
      const { res, hifrica } = await call({ method: "GET", url: "/", headers });
      assert.equal(res.statusCode, 200, JSON.stringify(headers));
      assert.match(String(res.headers["content-type"]), /^application\/json/);
      assert.deepEqual(res.json(), {
        service: "Hifrica — simulateurs",
        catalogue: `${APP}/catalogue`,
        docs: `${APP}/`,
        usage: "POST /<simulateur>/<chemin> avec Authorization: Bearer sk_test_...",
      });
      assert.equal(hifrica, null);
    }
  });

  it("navigateur avec Authorization sur / → le JSON, pas de redirection", async () => {
    const { res } = await call({ method: "GET", url: "/", headers: { ...BROWSER, ...KEY } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().service, "Hifrica — simulateurs");
  });

  it("navigateur sur un simulateur → 302 vers sa fiche, avec ou sans chemin, sans authentification", async () => {
    for (const url of ["/paiement-mobile-generique/v1/checkout/abc", "/paiement-mobile-generique/", "/paiement-mobile-generique", "/paiement-mobile-generique/v1/checkout?lang=fr"]) {
      const { res, hifrica } = await call({ method: "GET", url, headers: BROWSER });
      assert.equal(res.statusCode, 302, url);
      assert.equal(res.headers.location, `${APP}/catalogue/paiement-mobile-generique`, url);
      assert.equal(hifrica, null, `${url} : authenticate n'est pas appelé, rien n'est journalisé`);
    }
    // Un simulateur USSD a aussi sa fiche.
    const ussd = await call({ method: "GET", url: "/mobile-money-ussd/ussd", headers: BROWSER });
    assert.equal(ussd.res.headers.location, `${APP}/catalogue/mobile-money-ussd`);
  });

  it("navigateur sur un simulateur inconnu → 302 vers le catalogue", async () => {
    for (const url of ["/inconnu/v1/x", "/inconnu"]) {
      const { res, hifrica } = await call({ method: "GET", url, headers: BROWSER });
      assert.equal(res.statusCode, 302, url);
      assert.equal(res.headers.location, `${APP}/catalogue`, url);
      assert.equal(hifrica, null);
    }
  });

  it("navigateur avec Authorization sur un simulateur → comportement normal (clé valide 200, invalide 401)", async () => {
    const ok = await call({ method: "GET", url: "/paiement-mobile-generique/v1/checkout/abc", headers: { ...BROWSER, ...KEY } });
    assert.equal(ok.res.statusCode, 200);
    assert.equal(ok.res.json().id, "abc");
    assert.equal(ok.hifrica?.projectId, "demo");
    const bad = await call({ method: "GET", url: "/paiement-mobile-generique/v1/checkout/abc", headers: { ...BROWSER, authorization: "Bearer nope" } });
    assert.equal(bad.res.statusCode, 401);
    assert.deepEqual(bad.res.json(), { error: "invalid_test_key" });
  });

  it("POST avec Accept text/html → comportement normal (jamais de redirection)", async () => {
    const withKey = await call({
      method: "POST",
      url: "/paiement-mobile-generique/v1/checkout",
      headers: { ...BROWSER, ...KEY, "content-type": "application/json" },
      payload: { amount: 5000, merchant: "Boutique" },
    });
    assert.equal(withKey.res.statusCode, 201);
    assert.equal(withKey.res.json().amount, 5000);
    const withoutKey = await call({
      method: "POST",
      url: "/paiement-mobile-generique/v1/checkout",
      headers: { ...BROWSER, "content-type": "application/json" },
      payload: { amount: 5000 },
    });
    assert.equal(withoutKey.res.statusCode, 401);
    assert.deepEqual(withoutKey.res.json(), { error: "invalid_test_key" });
  });

  it("Accept: application/json ou curl sans clé → comportement normal (401, 404)", async () => {
    for (const headers of [{ accept: "application/json" }, CURL]) {
      const noKey = await call({ method: "GET", url: "/paiement-mobile-generique/v1/checkout/abc", headers });
      assert.equal(noKey.res.statusCode, 401);
      assert.deepEqual(noKey.res.json(), { error: "invalid_test_key" });
      const unknown = await call({ method: "GET", url: "/inconnu/v1/x", headers });
      assert.equal(unknown.res.statusCode, 404);
      assert.deepEqual(unknown.res.json(), { error: "simulator_not_found" });
      // /<simulateur> sans chemin : le 404 par défaut de Fastify, comme avant.
      const bare = await call({ method: "GET", url: "/paiement-mobile-generique", headers });
      assert.equal(bare.res.statusCode, 404);
      assert.deepEqual(bare.res.json(), { message: "Route GET:/paiement-mobile-generique not found", error: "Not Found", statusCode: 404 });
    }
  });

  it("appel avec une clé (bouchon de test) → réponse normale du simulateur, contexte rempli", async () => {
    const { res, hifrica } = await call({
      method: "POST",
      url: "/paiement-mobile-generique/v1/checkout",
      headers: { ...KEY, "content-type": "application/json" },
      payload: { amount: 1200, merchant: "Boutique" },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().status, "pending");
    assert.ok(res.headers["x-hifrica-request-id"]);
    assert.equal(hifrica?.simulator, "paiement-mobile-generique");
    assert.equal(hifrica?.projectId, "demo");
    assert.equal(hifrica?.endpointId, "checkout");
  });

  it("/health inchangé, même depuis un navigateur", async () => {
    for (const headers of [BROWSER, CURL]) {
      const { res } = await call({ method: "GET", url: "/health", headers });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json().status, "ok");
      assert.equal(res.json().service, "engine");
    }
  });

  it("route USSD (POST /:simulator/ussd) : jamais redirigée", async () => {
    const asBrowser = await call({ method: "POST", url: "/mobile-money-ussd/ussd", headers: { ...BROWSER, "content-type": "application/json" }, payload: {} });
    const asProgram = await call({ method: "POST", url: "/mobile-money-ussd/ussd", headers: { "content-type": "application/json" }, payload: {} });
    assert.notEqual(asBrowser.res.statusCode, 302);
    assert.equal(asBrowser.res.statusCode, asProgram.res.statusCode);
    assert.deepEqual(asBrowser.res.json(), asProgram.res.json());
  });
});

describe("règle navigateur et APP_PUBLIC_URL", () => {
  const req = (method: string, headers: Record<string, string>) => ({ method, headers }) as never;

  it("GET + Accept text/html + aucun Authorization, et rien d'autre", () => {
    assert.equal(isBrowserRequest(req("GET", { accept: "text/html" })), true);
    assert.equal(isBrowserRequest(req("GET", { accept: "TEXT/HTML;q=0.9" })), true);
    assert.equal(isBrowserRequest(req("GET", { accept: "text/html", authorization: "" })), false, "en-tête présent, même vide");
    assert.equal(isBrowserRequest(req("HEAD", { accept: "text/html" })), false);
    assert.equal(isBrowserRequest(req("POST", { accept: "text/html" })), false);
    assert.equal(isBrowserRequest(req("GET", { accept: "application/json" })), false);
    assert.equal(isBrowserRequest(req("GET", {})), false);
  });

  it("APP_PUBLIC_URL, sinon https://$APP_DOMAIN, sinon http://localhost:5173", () => {
    assert.equal(appPublicUrl({ APP_PUBLIC_URL: "https://app.exemple.test/", APP_DOMAIN: "autre.test" }), "https://app.exemple.test");
    assert.equal(appPublicUrl({ APP_DOMAIN: "app.hifrica.site" }), "https://app.hifrica.site");
    assert.equal(appPublicUrl({ APP_PUBLIC_URL: "  ", APP_DOMAIN: "" }), "http://localhost:5173");
    assert.equal(appPublicUrl({}), "http://localhost:5173");
  });
});
