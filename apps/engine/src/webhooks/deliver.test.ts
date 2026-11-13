import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { UnrecoverableError } from "bullmq";
import {
  isRetryable,
  processDelivery,
  sendWebhook,
  USER_AGENT,
  type Outcome,
  type WebhookJobData,
  type WebhookLogger,
} from "./deliver.js";
import { BACKOFF_DELAYS_MS, backoffDelay, MAX_ATTEMPTS } from "./queue.js";
import { verifyWebhookSignature } from "./signature.js";

const SECRET = "secret-de-test-ne-pas-loguer";
const BODY_MARKER = "contenu-confidentiel-du-corps";

interface Received {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/** Petit serveur local : le comportement dépend du chemin (/200, /500, /404, /302, /lent...). */
let server: Server;
let base = "";
let received: Received[] = [];

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const path = new URL(req.url ?? "/", "http://localhost").pathname; // sans la query
      received.push({ path, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      if (path === "/slow") return; // ne répond jamais
      if (path === "/302") {
        res.writeHead(302, { Location: `${base}/redirect-target` });
        return res.end();
      }
      if (path === "/big") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end("x".repeat(1_000_000));
      }
      const status = Number(path.slice(1)) || 200;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
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
  const make =
    (level: string) =>
    (obj: unknown, msg?: string): void => {
      lines.push({ level, obj, msg });
    };
  const log = { info: make("info"), warn: make("warn"), error: make("error") } as unknown as WebhookLogger;
  return { log, lines, text: () => JSON.stringify(lines) };
}

function job(overrides: Partial<WebhookJobData> = {}): WebhookJobData {
  return {
    deliveryId: "11111111-2222-4333-8444-555555555555",
    projectId: "demo",
    simulator: "paiement-mobile-generique",
    requestId: "req-abc",
    event: "checkout.completed",
    rawBody: JSON.stringify({
      id: "11111111-2222-4333-8444-555555555555",
      event: "checkout.completed",
      created_at: "2026-11-12T10:00:00.000Z",
      data: { status: "succeeded", note: BODY_MARKER },
    }),
    ...overrides,
  };
}

const send = (path: string, allowPrivate = true, timeoutMs?: number) =>
  sendWebhook({ url: `${base}${path}`, rawBody: "{}", headers: { "Content-Type": "application/json" }, allowPrivate, timeoutMs });

describe("sendWebhook (serveur HTTP local)", () => {
  it("200 → success", async () => {
    const r = await send("/200");
    assert.equal(r.outcome, "success");
    assert.equal(r.statusCode, 200);
    assert.equal(r.host, "127.0.0.1");
  });

  it("500 → http_error relancé", async () => {
    const r = await send("/500");
    assert.deepEqual([r.outcome, r.statusCode, isRetryable(r.outcome, r.statusCode)], ["http_error", 500, true]);
  });

  it("404 → http_error non relancé", async () => {
    const r = await send("/404");
    assert.deepEqual([r.outcome, r.statusCode, isRetryable(r.outcome, r.statusCode)], ["http_error", 404, false]);
  });

  it("302 → échec non relancé, la redirection n'est PAS suivie", async () => {
    const r = await send("/302");
    assert.deepEqual([r.outcome, r.statusCode, isRetryable(r.outcome, r.statusCode)], ["http_error", 302, false]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(received.map((x) => x.path), ["/302"], "aucune requête vers la cible de redirection");
  });

  it("gros corps de réponse : on n'attend pas sa lecture complète", async () => {
    const r = await send("/big");
    assert.equal(r.outcome, "success");
  });

  it("serveur lent → timeout au bout de 5 s (délai par défaut)", async () => {
    const r = await send("/slow");
    assert.equal(r.outcome, "timeout");
    assert.equal(r.statusCode, null);
    assert.ok(r.durationMs >= 4_900 && r.durationMs < 6_500, `durée ${r.durationMs} ms`);
    assert.equal(isRetryable(r.outcome, r.statusCode), true);
  });

  it("port fermé → network_error relancé", async () => {
    const tmp = createServer();
    await new Promise<void>((resolve) => tmp.listen(0, "127.0.0.1", resolve));
    const port = (tmp.address() as AddressInfo).port;
    await new Promise<void>((resolve) => tmp.close(() => resolve()));
    const r = await sendWebhook({ url: `http://127.0.0.1:${port}/`, rawBody: "{}", headers: {}, allowPrivate: true });
    assert.equal(r.outcome, "network_error");
    assert.equal(isRetryable(r.outcome, r.statusCode), true);
  });

  it("SSRF : IP privée littérale ou nom résolu en IP privée → blocked, rien n'est envoyé", async () => {
    const port = new URL(base).port;
    for (const url of [`http://127.0.0.1:${port}/200`, `http://localhost:${port}/200`, `http://[::1]:${port}/200`]) {
      const r = await sendWebhook({ url, rawBody: "{}", headers: {}, allowPrivate: false });
      assert.equal(r.outcome, "blocked", url);
      assert.equal(isRetryable(r.outcome, r.statusCode), false);
    }
    assert.equal(received.length, 0);
  });

  it("schéma ftp: → blocked", async () => {
    const r = await sendWebhook({ url: "ftp://example.com/hook", rawBody: "{}", headers: {}, allowPrivate: true });
    assert.equal(r.outcome, "blocked");
  });
});

describe("classification relance / pas de relance", () => {
  it("pour chaque outcome et code", () => {
    const cases: [Outcome, number | null, boolean][] = [
      ["success", 200, false],
      ["success", 204, false],
      ["network_error", null, true],
      ["timeout", null, true],
      ["blocked", null, false],
      ["http_error", 500, true],
      ["http_error", 502, true],
      ["http_error", 503, true],
      ["http_error", 408, true],
      ["http_error", 429, true],
      ["http_error", 301, false],
      ["http_error", 302, false],
      ["http_error", 307, false],
      ["http_error", 400, false],
      ["http_error", 401, false],
      ["http_error", 403, false],
      ["http_error", 404, false],
      ["http_error", 410, false],
      ["http_error", 422, false],
    ];
    for (const [outcome, status, expected] of cases) {
      assert.equal(isRetryable(outcome, status), expected, `${outcome} ${status}`);
    }
  });

  it("backoff : 4 tentatives, 10 s, 30 s puis 90 s", () => {
    assert.equal(MAX_ATTEMPTS, 4);
    assert.deepEqual([1, 2, 3].map(backoffDelay), [10_000, 30_000, 90_000]);
    assert.deepEqual([...BACKOFF_DELAYS_MS], [10_000, 30_000, 90_000]);
  });
});

describe("processDelivery", () => {
  const deps = (path: string, log: WebhookLogger, extra: Record<string, unknown> = {}) => ({
    url: `${base}${path}?token=jeton-dans-url`,
    secret: SECRET,
    allowPrivate: true,
    log,
    ...extra,
  });

  it("envoie le corps exact, les en-têtes Hifrica et une signature vérifiable avec le secret", async () => {
    const { log } = captureLogger();
    const data = job();
    const result = await processDelivery(data, 2, deps("/200", log));
    assert.equal(result?.outcome, "success");

    assert.equal(received.length, 1);
    const r = received[0];
    assert.equal(r.body, data.rawBody, "mêmes octets que le corps programmé");
    assert.equal(r.headers["content-type"], "application/json");
    assert.equal(r.headers["user-agent"], USER_AGENT);
    assert.equal(r.headers["x-hifrica-event"], "checkout.completed");
    assert.equal(r.headers["x-hifrica-delivery"], data.deliveryId);
    assert.equal(r.headers["x-hifrica-request-id"], "req-abc");
    assert.equal(r.headers["x-hifrica-attempt"], "2");
    const signature = String(r.headers["x-hifrica-signature"]);
    assert.match(signature, /^t=\d+,v1=[0-9a-f]{64}$/);
    assert.equal(verifyWebhookSignature(SECRET, signature, r.body), true);
    assert.equal(verifyWebhookSignature("mauvais-secret", signature, r.body), false);
  });

  it("le timestamp de signature est recalculé à chaque tentative, le corps reste identique", async () => {
    const { log } = captureLogger();
    const data = job();
    await processDelivery(data, 1, deps("/200", log, { now: () => 1_794_000_000_000 }));
    await processDelivery(data, 2, deps("/200", log, { now: () => 1_794_000_010_000 }));
    const [a, b] = received;
    assert.equal(a.body, b.body);
    assert.match(String(a.headers["x-hifrica-signature"]), /^t=1794000000,/);
    assert.match(String(b.headers["x-hifrica-signature"]), /^t=1794000010,/);
  });

  for (const [path, retry] of [
    ["/500", true],
    ["/503", true],
    ["/408", true],
    ["/429", true],
    ["/404", false],
    ["/400", false],
    ["/302", false],
  ] as [string, boolean][]) {
    it(`${path.slice(1)} → ${retry ? "Error (relance)" : "UnrecoverableError (pas de relance)"}`, async () => {
      const { log } = captureLogger();
      await assert.rejects(processDelivery(job(), 1, deps(path, log)), (err: Error) => {
        assert.equal(err instanceof UnrecoverableError, !retry);
        return true;
      });
    });
  }

  it("timeout → relance ; blocked → pas de relance", async () => {
    const { log } = captureLogger();
    await assert.rejects(processDelivery(job(), 1, deps("/slow", log, { timeoutMs: 200 })), (err: Error) => {
      assert.equal(err instanceof UnrecoverableError, false);
      assert.equal(err.message, "timeout");
      return true;
    });
    await assert.rejects(processDelivery(job(), 1, deps("/200", log, { allowPrivate: false })), (err: Error) => {
      assert.ok(err instanceof UnrecoverableError);
      assert.equal(err.message, "blocked");
      return true;
    });
  });

  it("sans URL : rien n'est envoyé ; sans secret : abandon sans envoi", async () => {
    const { log, lines } = captureLogger();
    assert.equal(await processDelivery(job(), 1, { url: undefined, secret: SECRET, allowPrivate: true, log }), null);
    assert.equal(lines[0]?.msg, "aucune URL de webhook : rien n'est envoyé");
    await assert.rejects(processDelivery(job(), 1, { url: `${base}/200`, secret: undefined, allowPrivate: true, log }), UnrecoverableError);
    assert.equal(received.length, 0);
  });

  it("logue chaque tentative sans secret, corps, signature ni URL complète", async () => {
    const { log, lines, text } = captureLogger();
    await processDelivery(job(), 1, deps("/200", log));
    await processDelivery(job(), 2, deps("/500", log)).catch(() => undefined);

    assert.deepEqual(
      lines.map((l) => {
        const o = l.obj as Record<string, unknown>;
        return [l.level, o.attempt, o.outcome, o.statusCode, o.host, o.deliveryId, o.requestId, o.projectId, o.event];
      }),
      [
        ["info", 1, "success", 200, "127.0.0.1", job().deliveryId, "req-abc", "demo", "checkout.completed"],
        ["warn", 2, "http_error", 500, "127.0.0.1", job().deliveryId, "req-abc", "demo", "checkout.completed"],
      ],
    );
    assert.ok(lines.every((l) => typeof (l.obj as { durationMs?: unknown }).durationMs === "number"));
    const all = text();
    assert.ok(!all.includes(SECRET), "secret");
    assert.ok(!all.includes(BODY_MARKER), "corps");
    assert.ok(!all.includes("v1="), "signature");
    assert.ok(!all.includes("jeton-dans-url") && !all.includes("/200") && !all.includes(base), "URL complète");
  });
});
