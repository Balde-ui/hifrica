import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { loadExampleYaml } from "./prompt.js";
import { Quota } from "./quota.js";
import { aiRoutes, type AiRoutesOptions } from "./routes.js";

const VALID_YAML = loadExampleYaml() ?? "";
const INVALID_YAML = "name: Pas Valide\nkind: http\n";
const DESCRIPTION = "Un simulateur de paiement par QR code, contact awa@boutique.sn, échec si marchand suspendu";
const DEEPSEEK_KEY = "sk-deepseek-secret-0000";
const GEMINI_KEY = "AIza-gemini-secret-0000";

type Reply = { status: number; body?: unknown } | { throws: Error };

interface Call {
  provider: "deepseek" | "gemini";
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** fetch simulé : renvoie dans l'ordre les réponses prévues pour chaque fournisseur. */
function fakeFetch(script: { deepseek?: Reply[]; gemini?: Reply[] }) {
  const calls: Call[] = [];
  const queues = { deepseek: [...(script.deepseek ?? [])], gemini: [...(script.gemini ?? [])] };
  const impl: typeof fetch = async (input, init) => {
    const url = String(input);
    const provider = url.startsWith("https://api.deepseek.com/") ? "deepseek" : "gemini";
    calls.push({
      provider,
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const next = queues[provider].shift();
    if (!next) throw new Error(`appel ${provider} inattendu`);
    if ("throws" in next) throw next.throws;
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status, headers: { "content-type": "application/json" } });
  };
  return { impl, calls };
}

const deepseekOk = (yaml: string): Reply => ({
  status: 200,
  body: { choices: [{ message: { role: "assistant", content: JSON.stringify({ yaml }) }, finish_reason: "stop" }] },
});
const geminiOk = (yaml: string): Reply => ({
  status: 200,
  body: { candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify({ yaml }) }] }, finishReason: "STOP" }] },
});

async function buildApp(options: AiRoutesOptions) {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  // Même réglage que src/index.ts : seul le premier saut (Caddy) est de confiance.
  const app = Fastify({ logger: { level: "info", stream }, trustProxy: (_address, hop) => hop === 0 });
  await app.register(aiRoutes, options);
  return { app, logs: lines };
}

const post = (app: Awaited<ReturnType<typeof buildApp>>["app"], payload: unknown, ip = "203.0.113.7") =>
  app.inject({
    method: "POST",
    url: "/api/simulators/generate",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    payload: JSON.stringify(payload),
  });

describe("POST /api/simulators/generate", () => {
  it("l'exemple de référence est lu et valide", () => {
    assert.match(VALID_YAML, /name: paiement-mobile-generique/);
  });

  it("YAML valide dès le 1er essai (DeepSeek), description masquée, json mode", async () => {
    const f = fakeFetch({ deepseek: [deepseekOk(VALID_YAML)] });
    const { app, logs } = await buildApp({ env: { DEEPSEEK_API_KEY: DEEPSEEK_KEY }, fetch: f.impl });
    const res = await post(app, { description: DESCRIPTION, kind: "http" });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
      valid: true,
      yaml: VALID_YAML,
      provider: "deepseek",
      attempts: 1,
      aiGenerated: true,
      notice: "Généré par IA, à vérifier",
    });
    assert.equal(f.calls.length, 1);
    const call = f.calls[0];
    assert.equal(call.url, "https://api.deepseek.com/chat/completions");
    assert.equal(call.headers.Authorization, `Bearer ${DEEPSEEK_KEY}`);
    assert.equal(call.body.model, "deepseek-flash");
    assert.deepEqual(call.body.response_format, { type: "json_object" });
    assert.equal(call.body.temperature, 0.2);
    const sent = JSON.stringify(call.body.messages);
    assert.ok(!sent.includes("awa@boutique.sn"), "l'email ne doit jamais être envoyé");
    assert.ok(sent.includes("[EMAIL]"));
    assert.ok(sent.includes("json"), "le mot json doit être dans le prompt");
    assert.ok(sent.includes('"$id\\":\\"https://hifrica/simulator.schema.json'), "le JSON Schema complet est dans le prompt");

    // Les logs ne contiennent ni la description, ni le YAML, ni la clé.
    const allLogs = logs.join("");
    assert.ok(!allLogs.includes("QR code"));
    assert.ok(!allLogs.includes("awa@boutique.sn"));
    assert.ok(!allLogs.includes("paiement-mobile-generique"));
    assert.ok(!allLogs.includes(DEEPSEEK_KEY));
    assert.match(allLogs, /"provider":"deepseek","attempts":1,"durationMs":\d+,"status":200/);
  });

  it("YAML invalide puis corrigé : erreurs et YAML fautif renvoyés au même fournisseur", async () => {
    const f = fakeFetch({ deepseek: [deepseekOk(INVALID_YAML), deepseekOk(VALID_YAML)] });
    const { app } = await buildApp({ env: { DEEPSEEK_API_KEY: DEEPSEEK_KEY, GEMINI_API_KEY: GEMINI_KEY }, fetch: f.impl });
    const res = await post(app, { description: DESCRIPTION });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().attempts, 2);
    assert.equal(res.json().provider, "deepseek");
    assert.deepEqual(f.calls.map((c) => c.provider), ["deepseek", "deepseek"]);
    const messages = f.calls[1].body.messages as { role: string; content: string }[];
    assert.deepEqual(messages.map((m) => m.role), ["system", "user", "assistant", "user"]);
    const correction = messages[3].content;
    assert.ok(correction.includes("Pas Valide"), "le YAML fautif est renvoyé");
    assert.ok(correction.includes("/name"), "les erreurs de validation sont renvoyées");
  });

  it("3 échecs de validation → 422 avec le dernier YAML et les erreurs", async () => {
    const f = fakeFetch({ deepseek: [deepseekOk(INVALID_YAML), deepseekOk(INVALID_YAML), deepseekOk("name: encore-faux\n")] });
    const { app } = await buildApp({ env: { DEEPSEEK_API_KEY: DEEPSEEK_KEY }, fetch: f.impl });
    const res = await post(app, { description: DESCRIPTION });

    assert.equal(res.statusCode, 422);
    const body = res.json();
    assert.equal(body.valid, false);
    assert.equal(body.attempts, 3);
    assert.equal(body.provider, "deepseek");
    assert.equal(body.yaml, "name: encore-faux\n");
    assert.ok(Array.isArray(body.errors) && body.errors.length > 0);
    assert.equal(f.calls.length, 3);
  });

  it("le kind imposé est vérifié : un simulateur http alors que ussd est demandé est corrigé", async () => {
    const f = fakeFetch({ deepseek: [deepseekOk(VALID_YAML), deepseekOk(VALID_YAML), deepseekOk(VALID_YAML)] });
    const { app } = await buildApp({ env: { DEEPSEEK_API_KEY: DEEPSEEK_KEY }, fetch: f.impl });
    const res = await post(app, { description: DESCRIPTION, kind: "ussd" });
    assert.equal(res.statusCode, 422);
    assert.match(res.json().errors[0], /kind doit valoir "ussd"/);
  });

  for (const [label, failure] of [
    ["HTTP 500", { status: 500, body: { error: "boom" } }],
    ["HTTP 401", { status: 401, body: { error: "bad key" } }],
    ["timeout", { throws: Object.assign(new Error("timeout"), { name: "TimeoutError" }) }],
    ["réseau", { throws: new TypeError("fetch failed") }],
    ["réponse illisible (contenu vide du json mode)", { status: 200, body: { choices: [{ message: { content: "   " } }] } }],
  ] as [string, Reply][]) {
    it(`DeepSeek en erreur (${label}) → Gemini utilisé`, async () => {
      const f = fakeFetch({ deepseek: [failure], gemini: [geminiOk(VALID_YAML)] });
      const { app, logs } = await buildApp({ env: { DEEPSEEK_API_KEY: DEEPSEEK_KEY, GEMINI_API_KEY: GEMINI_KEY }, fetch: f.impl });
      const res = await post(app, { description: DESCRIPTION });

      assert.equal(res.statusCode, 200);
      assert.equal(res.json().provider, "gemini");
      assert.equal(res.json().attempts, 1);
      const g = f.calls[1];
      assert.equal(g.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
      assert.equal(g.headers["x-goog-api-key"], GEMINI_KEY);
      assert.ok(!g.url.includes(GEMINI_KEY), "la clé ne passe jamais dans l'URL");
      assert.ok(g.body.systemInstruction);
      assert.deepEqual((g.body.generationConfig as { responseMimeType: string }).responseMimeType, "application/json");
      assert.ok(!JSON.stringify(g.body).includes("awa@boutique.sn"));
      assert.ok(!logs.join("").includes(GEMINI_KEY) && !logs.join("").includes(DEEPSEEK_KEY));
    });
  }

  it("seule la clé Gemini configurée → Gemini directement", async () => {
    const f = fakeFetch({ gemini: [geminiOk(VALID_YAML)] });
    const { app } = await buildApp({ env: { GEMINI_API_KEY: GEMINI_KEY, GEMINI_MODEL: "gemini-2.5-flash" }, fetch: f.impl });
    const res = await post(app, { description: DESCRIPTION });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().provider, "gemini");
    assert.match(f.calls[0].url, /models\/gemini-2\.5-flash:generateContent$/);
    // thinkingLevel provoque une erreur sur les modèles 2.x : il n'est pas envoyé.
    assert.equal((f.calls[0].body.generationConfig as Record<string, unknown>).thinkingConfig, undefined);
  });

  it("tous les fournisseurs en erreur → 503 ai_unavailable", async () => {
    const f = fakeFetch({ deepseek: [{ status: 503 }], gemini: [{ status: 429 }] });
    const { app } = await buildApp({ env: { DEEPSEEK_API_KEY: DEEPSEEK_KEY, GEMINI_API_KEY: GEMINI_KEY }, fetch: f.impl });
    const res = await post(app, { description: DESCRIPTION });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.json(), { error: "ai_unavailable" });
  });

  it("aucune clé configurée → 503 ai_unavailable, sans appel réseau", async () => {
    const f = fakeFetch({});
    const { app } = await buildApp({ env: {}, fetch: f.impl });
    const res = await post(app, { description: DESCRIPTION });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.json(), { error: "ai_unavailable" });
    assert.equal(f.calls.length, 0);
  });

  it("quota : 10 générations par heure et par IP, puis 429 avec retryAfter", async () => {
    let now = 1_000_000;
    const quota = new Quota(10, 3_600_000, () => now);
    const f = fakeFetch({ deepseek: Array.from({ length: 12 }, () => deepseekOk(VALID_YAML)) });
    const { app } = await buildApp({ env: { DEEPSEEK_API_KEY: DEEPSEEK_KEY }, fetch: f.impl, quota });

    for (let i = 0; i < 10; i++) {
      assert.equal((await post(app, { description: DESCRIPTION }, "198.51.100.1")).statusCode, 200);
    }
    const blocked = await post(app, { description: DESCRIPTION }, "198.51.100.1");
    assert.equal(blocked.statusCode, 429);
    assert.deepEqual(blocked.json(), { error: "quota_exceeded", retryAfter: 3600 });
    assert.equal(blocked.headers["retry-after"], "3600");
    assert.equal(f.calls.length, 10, "aucun appel IA quand le quota est dépassé");

    // Une autre IP (X-Forwarded-For) a son propre quota.
    assert.equal((await post(app, { description: DESCRIPTION }, "198.51.100.2")).statusCode, 200);
    // Une heure plus tard, la première IP peut de nouveau générer.
    now += 3_600_000;
    assert.equal((await post(app, { description: DESCRIPTION }, "198.51.100.1")).statusCode, 200);
  });

  it("corps invalide → 400", async () => {
    const { app } = await buildApp({ env: { DEEPSEEK_API_KEY: DEEPSEEK_KEY }, fetch: fakeFetch({}).impl });
    for (const payload of [
      {},
      { description: 42 },
      { description: "court" },
      { description: "x".repeat(2001) },
      { description: DESCRIPTION, kind: "sms" },
    ]) {
      const res = await post(app, payload);
      assert.equal(res.statusCode, 400, JSON.stringify(payload).slice(0, 60));
      assert.equal(res.json().error, "invalid_body");
    }
  });
});
