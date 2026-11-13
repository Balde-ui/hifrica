import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { encryptWebhookSecret, generateWebhookSecret, parseWebhookSecretKeyring, type Database } from "@hifrica/db";
import { UnrecoverableError } from "bullmq";
import { processDelivery, type WebhookJobData, type WebhookLogger } from "./deliver.js";
import type { DeliveryRecord } from "./history.js";
import { loadKeyring } from "./index.js";
import { verifyWebhookSignature } from "./signature.js";
import { createTargetResolver, type ProjectWebhookRow } from "./target.js";

const PROJECT_ID = randomUUID();
const keyring = parseWebhookSecretKeyring(`v1:${randomBytes(32).toString("base64")}`);
const PROJECT_SECRET = generateWebhookSecret();
const FAKE_DB = {} as Database; // seule sa présence compte : la lecture passe par loadProject

let server: Server;
let base = "";
let received: { path: string; headers: IncomingHttpHeaders; body: string }[] = [];

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      received.push({ path, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(Number(path.split("/").pop()) || 200).end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});
beforeEach(() => {
  received = [];
});

function captureLogger() {
  const lines: { level: string; obj: unknown; msg?: string }[] = [];
  const at = (level: string) => (obj: unknown, msg?: string) => void lines.push({ level, obj, msg });
  return { log: { info: at("info"), warn: at("warn"), error: at("error") } as unknown as WebhookLogger, lines, text: () => JSON.stringify(lines) };
}

const job = (over: Partial<WebhookJobData> = {}): WebhookJobData => ({
  deliveryId: randomUUID(),
  projectId: PROJECT_ID,
  simulator: "paiement-mobile-generique",
  requestId: randomUUID(),
  event: "checkout.completed",
  rawBody: JSON.stringify({ id: "d", event: "checkout.completed", created_at: "2026-11-13T10:00:00.000Z", data: { secretMetier: "corps-confidentiel" } }),
  ...over,
});

/** Projet « en base » : URL et secret chiffré exactement comme les écrit l'API (C2). */
function projectRow(webhookUrl: string | null, projectId = PROJECT_ID, secret = PROJECT_SECRET): ProjectWebhookRow {
  return { webhookUrl, webhookSecretEnc: encryptWebhookSecret(secret, projectId, keyring) };
}

function resolverFor(rows: () => ProjectWebhookRow | null, opts: { env?: Record<string, string>; keyring?: typeof keyring | null; db?: Database | null } = {}) {
  const { log, lines } = captureLogger();
  const loads: string[] = [];
  const resolve = createTargetResolver({
    getDb: () => (opts.db === undefined ? FAKE_DB : opts.db),
    keyring: opts.keyring === undefined ? keyring : opts.keyring,
    env: opts.env ?? {},
    log,
    loadProject: async (_db, projectId) => {
      loads.push(projectId);
      return rows();
    },
  });
  return { resolve, loads, lines };
}

describe("A5 : URL et secret du projet, lus au moment de l'envoi", () => {
  it("l'URL du projet est utilisée, et la signature se vérifie avec le secret du projet", async () => {
    const { resolve } = resolverFor(() => projectRow(`${base}/hooks/projet`));
    const { log, text } = captureLogger();
    const result = await processDelivery(job(), 1, { resolve, allowPrivate: true, log });
    assert.equal(result?.outcome, "success");
    assert.equal(received.length, 1);
    assert.equal(received[0].path, "/hooks/projet");
    const signature = String(received[0].headers["x-hifrica-signature"]);
    assert.equal(verifyWebhookSignature(PROJECT_SECRET, signature, received[0].body), true, "signé avec le secret du projet");
    assert.equal(verifyWebhookSignature("whsec_autre", signature, received[0].body), false);
    assert.ok(!text().includes(PROJECT_SECRET), "le secret n'est jamais logué");
  });

  it("l'URL est relue à chaque tentative : une modification s'applique à l'envoi suivant", async () => {
    let url = `${base}/ancienne/500`;
    const { resolve, loads } = resolverFor(() => projectRow(url));
    const { log } = captureLogger();
    const data = job();
    await assert.rejects(processDelivery(data, 1, { resolve, allowPrivate: true, log }));
    url = `${base}/nouvelle`; // l'utilisateur change l'URL dans « Paramètres »
    assert.equal((await processDelivery(data, 2, { resolve, allowPrivate: true, log }))?.outcome, "success");
    assert.deepEqual(received.map((r) => r.path), ["/ancienne/500", "/nouvelle"]);
    assert.equal(loads.length, 2);
  });

  it("projet sans URL → no_url : rien n'est envoyé, pas de relance (le job se termine), historique écrit", async () => {
    const { resolve } = resolverFor(() => projectRow(null));
    const rows: DeliveryRecord[] = [];
    const { log, lines } = captureLogger();
    assert.equal(await processDelivery(job(), 1, { resolve, record: async (r) => void rows.push(r), allowPrivate: true, log }), null);
    assert.equal(received.length, 0);
    assert.deepEqual([rows[0].outcome, rows[0].statusCode, rows[0].destinationHost, rows[0].durationMs], ["no_url", null, null, 0]);
    assert.ok(!lines.some((l) => l.level === "error"), "cas normal : pas d'erreur");
  });

  it("projet introuvable (supprimé) ou identifiant non uuid → no_url", async () => {
    const { resolve, loads } = resolverFor(() => null);
    assert.deepEqual(await resolve(PROJECT_ID), { ok: false, outcome: "no_url", host: null });
    assert.deepEqual(await resolve("demo"), { ok: false, outcome: "no_url", host: null });
    assert.deepEqual(loads, [PROJECT_ID], "aucune requête SQL pour un identifiant non uuid");
  });

  it("keyring absent ou secret indéchiffrable → no_secret : rien n'est envoyé, abandon sans relance", async () => {
    const otherKeyring = parseWebhookSecretKeyring(`v1:${randomBytes(32).toString("base64")}`);
    for (const [label, opts, row] of [
      ["keyring absent", { keyring: null }, projectRow(`${base}/x`)],
      ["mauvaise clé", { keyring: otherKeyring }, projectRow(`${base}/x`)],
      ["secret chiffré pour un autre projet (AAD)", {}, projectRow(`${base}/x`, randomUUID())],
    ] as const) {
      const { resolve, lines } = resolverFor(() => row, opts);
      const rows: DeliveryRecord[] = [];
      const { log } = captureLogger();
      await assert.rejects(processDelivery(job(), 1, { resolve, record: async (r) => void rows.push(r), allowPrivate: true, log }), (err: Error) => {
        assert.ok(err instanceof UnrecoverableError, label);
        assert.equal(err.message, "no_secret");
        return true;
      });
      assert.equal(rows[0].outcome, "no_secret", label);
      assert.equal(rows[0].destinationHost, "127.0.0.1", label);
      assert.ok(lines.some((l) => l.level === "error"), `${label} : erreur loguée`);
    }
    assert.equal(received.length, 0);
  });

  it("base injoignable → erreur passagère : relance normale, rien n'est envoyé ni enregistré", async () => {
    const rows: DeliveryRecord[] = [];
    const { log } = captureLogger();
    const resolve = createTargetResolver({
      getDb: () => FAKE_DB, keyring, env: {}, log,
      loadProject: async () => {
        throw new Error("connection");
      },
    });
    await assert.rejects(processDelivery(job(), 1, { resolve, record: async (r) => void rows.push(r), allowPrivate: true, log }), (err: Error) => {
      assert.equal(err instanceof UnrecoverableError, false, "relancé par BullMQ");
      return true;
    });
    assert.equal(rows.length, 0);
    assert.equal(received.length, 0);
  });

  it("la protection SSRF s'applique à l'URL du projet", async () => {
    const { resolve } = resolverFor(() => projectRow(`${base}/interne`));
    const rows: DeliveryRecord[] = [];
    const { log } = captureLogger();
    await assert.rejects(processDelivery(job(), 1, { resolve, record: async (r) => void rows.push(r), allowPrivate: false, log }), UnrecoverableError);
    assert.equal(received.length, 0);
    assert.equal(rows[0].outcome, "blocked");
  });
});

describe("A5 : bouchons WEBHOOK_TEST_URL / WEBHOOK_SIGNING_SECRET", () => {
  const stubs = () => ({ WEBHOOK_TEST_URL: `${base}/bouchon`, WEBHOOK_SIGNING_SECRET: "secret-bouchon" });

  it("ignorés dès qu'il y a une base, en production comme en développement", async () => {
    for (const NODE_ENV of ["production", "development"]) {
      const { resolve } = resolverFor(() => projectRow(null), { env: { ...stubs(), NODE_ENV } });
      assert.deepEqual(await resolve(PROJECT_ID), { ok: false, outcome: "no_url", host: null }, NODE_ENV);
      const withUrl = resolverFor(() => projectRow(`${base}/projet`), { env: { ...stubs(), NODE_ENV } });
      const target = await withUrl.resolve(PROJECT_ID);
      assert.ok(target.ok);
      assert.equal(target.url, `${base}/projet`);
      assert.equal(target.secret, PROJECT_SECRET);
    }
  });

  it("utilisés seulement sans base et hors production", async () => {
    const dev = resolverFor(() => null, { db: null, env: stubs() });
    assert.deepEqual(await dev.resolve("demo"), { ok: true, url: `${base}/bouchon`, secret: "secret-bouchon" });
    assert.equal(dev.loads.length, 0);
    const prod = resolverFor(() => null, { db: null, env: { ...stubs(), NODE_ENV: "production" } });
    assert.deepEqual(await prod.resolve("demo"), { ok: false, outcome: "no_url", host: null });
    const noSecret = resolverFor(() => null, { db: null, env: { WEBHOOK_TEST_URL: `${base}/bouchon` } });
    assert.deepEqual(await noSecret.resolve("demo"), { ok: false, outcome: "no_secret", host: "127.0.0.1" });
  });

  it("keyring : lu depuis WEBHOOK_SECRET_KEYS ; absent ou invalide → null, erreur en production", () => {
    const { log, lines } = captureLogger();
    assert.ok(loadKeyring({ WEBHOOK_SECRET_KEYS: `v1:${randomBytes(32).toString("base64")}` }, log, true));
    assert.equal(loadKeyring({ NODE_ENV: "production" }, log, true), null);
    assert.equal(loadKeyring({ NODE_ENV: "production", WEBHOOK_SECRET_KEYS: "pas-une-cle" }, log, true), null);
    assert.equal(lines.filter((l) => l.level === "error").length, 2);
    assert.equal(loadKeyring({ WEBHOOK_SECRET_KEYS: "pas-une-cle" }, log, false), null, "sans base : inutile");
  });
});

describe("A5 : historique webhook_deliveries", () => {
  it("une ligne par tentative, avec l'hôte seulement (ni URL, ni corps, ni secret, ni signature)", async () => {
    const { resolve } = resolverFor(() => projectRow(`${base}/hooks/500?token=jeton-dans-url`));
    const rows: DeliveryRecord[] = [];
    const record = async (r: DeliveryRecord) => void rows.push(r);
    const { log } = captureLogger();
    const data = job();
    await assert.rejects(processDelivery(data, 1, { resolve, record, allowPrivate: true, log }));
    const ok = resolverFor(() => projectRow(`${base}/hooks/200`));
    await processDelivery(data, 2, { resolve: ok.resolve, record, allowPrivate: true, log });

    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => [r.deliveryId, r.projectId, r.requestId, r.event, r.attempt, r.outcome, r.statusCode, r.destinationHost]),
      [
        [data.deliveryId, PROJECT_ID, data.requestId, "checkout.completed", 1, "http_error", 500, "127.0.0.1"],
        [data.deliveryId, PROJECT_ID, data.requestId, "checkout.completed", 2, "success", 200, "127.0.0.1"],
      ],
    );
    assert.ok(rows.every((r) => typeof r.durationMs === "number" && r.durationMs >= 0));
    const all = JSON.stringify(rows);
    for (const forbidden of ["jeton-dans-url", "/hooks", "corps-confidentiel", PROJECT_SECRET, "v1="]) {
      assert.ok(!all.includes(forbidden), forbidden);
    }
  });

  it("un échec d'insertion (rejet ou exception) ne bloque ni ne change l'envoi, et il est logué", async () => {
    for (const record of [
      async () => {
        throw new Error("insert_webhook_delivery");
      },
      () => {
        throw new Error("synchrone");
      },
    ] as ((r: DeliveryRecord) => Promise<void>)[]) {
      const { resolve } = resolverFor(() => projectRow(`${base}/hooks/200`));
      const { log, lines } = captureLogger();
      const result = await processDelivery(job(), 1, { resolve, record, allowPrivate: true, log });
      assert.equal(result?.outcome, "success");
      await new Promise((r) => setImmediate(r));
      assert.ok(lines.some((l) => l.level === "warn" && l.msg === "historique du webhook non enregistré"));
    }
    // Échec d'insertion sur une tentative ratée : l'erreur propagée reste celle de l'envoi (relance).
    const { resolve } = resolverFor(() => projectRow(`${base}/hooks/503`));
    const { log } = captureLogger();
    await assert.rejects(
      processDelivery(job(), 1, { resolve, record: async () => { throw new Error("db"); }, allowPrivate: true, log }),
      (err: Error) => err.message === "http_error_503" && !(err instanceof UnrecoverableError),
    );
  });
});
