import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { isHifricaEvent, projectChannel, validateSimulatorYaml } from "@hifrica/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import "./context.js";
import type { Simulator } from "./simulators.js";
import { registerUssd } from "./ussd.js";
import { registerValkey, sharedValkey } from "./valkey.js";

const YAML = readFileSync(new URL("../../../simulators/mobile-money-ussd.yaml", import.meta.url), "utf8");
const parsed = validateSimulatorYaml(YAML);
assert.ok(parsed.valid, parsed.errors.join("; "));
const SIMULATOR = parsed.simulator as Simulator;
const simulators = new Map([[SIMULATOR.name, SIMULATOR]]);

const AUTH = { authorization: "Bearer sk_test_demo" };

describe("moteur USSD — avec un vrai Valkey (TEST_VALKEY_URL)", { skip: !process.env.TEST_VALKEY_URL }, () => {
  const url = process.env.TEST_VALKEY_URL as string;
  let app: FastifyInstance;
  let sub: Redis;
  const received: unknown[] = [];

  const capturedContexts: unknown[] = [];

  before(async () => {
    app = Fastify({ logger: false });
    app.decorateRequest("hifrica", null);
    app.addHook("onResponse", async (req) => void capturedContexts.push(req.hifrica));
    registerValkey(app, { VALKEY_URL: url });
    registerUssd(app, simulators);
    await app.ready();
    await waitFor(() => sharedValkey()?.status === "ready");

    sub = new Redis(url);
    sub.on("message", (_c: string, m: string) => received.push(JSON.parse(m)));
    await sub.subscribe(projectChannel("demo"));
  });

  after(async () => {
    sub.disconnect();
    await app.close();
  });

  function dial(body: { sessionId?: string; text?: string }) {
    return app.inject({ method: "POST", url: "/mobile-money-ussd/ussd", headers: AUTH, payload: body });
  }

  it("sans clé valide → 401", async () => {
    const res = await app.inject({ method: "POST", url: "/mobile-money-ussd/ussd", payload: { text: "" } });
    assert.equal(res.statusCode, 401);
  });

  it("simulateur inconnu → 404", async () => {
    const res = await app.inject({ method: "POST", url: "/inconnu/ussd", headers: AUTH, payload: {} });
    assert.equal(res.statusCode, 404);
  });

  it("premier appel : affiche le menu start, publie ussd.screen", async () => {
    received.length = 0;
    const res = await dial({});
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.end, false);
    assert.match(body.text, /1\. Solde/);
    assert.ok(typeof body.sessionId === "string" && body.sessionId.length > 0);

    await waitFor(() => received.length === 1);
    const event = received[0] as Record<string, unknown>;
    assert.equal(isHifricaEvent(received[0]), true);
    assert.equal(event.type, "ussd.screen");
    assert.equal(event.end, false);
  });

  it("parcours complet solde : menu -> PIN (sensible, non journalisé) -> solde -> fin", async () => {
    received.length = 0;
    const start = await dial({});
    const sessionId = start.json().sessionId as string;

    const afterChoice = await dial({ sessionId, text: "1" });
    assert.match(afterChoice.json().text, /code secret/);

    const afterPin = await dial({ sessionId, text: "0000" });
    assert.equal(afterPin.json().text, "Votre solde est de 15 000 XOF.");
    assert.equal(afterPin.json().end, true);

    // Session terminée (supprimée de Valkey) : réutiliser le même id redémarre un nouvel appel,
    // comme une session inconnue — un vrai téléphone ne renverrait de toute façon jamais cet id après
    // avoir raccroché.
    const afterEnd = await dial({ sessionId, text: "x" });
    assert.equal(afterEnd.statusCode, 200);
    assert.match(afterEnd.json().text, /1\. Solde/);

    await waitFor(() => received.filter((e) => (e as { type: string }).type === "ussd.end").length === 1);
    // Le PIN "0000" ne doit apparaître dans AUCUN événement publié pendant ce parcours.
    assert.ok(!JSON.stringify(received).includes("0000"), "le PIN ne doit jamais apparaître dans les événements");
    const inputEvents = received.filter((e) => (e as { type: string }).type === "ussd.input");
    // Un seul ussd.input (le choix "1"), pas un second pour la saisie sensible du PIN.
    assert.equal(inputEvents.length, 1);
    assert.equal((inputEvents[0] as { input: string }).input, "1");
  });

  it("parcours envoi d'argent : saisie libre + gabarit {{amount}} dans l'écran suivant", async () => {
    const start = await dial({});
    const sessionId = start.json().sessionId as string;
    await dial({ sessionId, text: "2" }); // -> pin_send
    await dial({ sessionId, text: "1111" }); // PIN -> amount
    const confirm = await dial({ sessionId, text: "2500" }); // montant -> confirm_send
    assert.match(confirm.json().text, /Envoyer 2500 XOF \?/);
    const sent = await dial({ sessionId, text: "1" }); // confirme -> sent
    assert.equal(sent.json().text, "2500 XOF envoyés avec succès.");
    assert.equal(sent.json().end, true);
  });

  it("saisie qui ne correspond à rien dans `on` et sans `next` : redemande le même menu", async () => {
    const start = await dial({});
    const sessionId = start.json().sessionId as string;
    const res = await dial({ sessionId, text: "9" }); // ne correspond à rien dans start.on
    assert.equal(res.statusCode, 200);
    assert.match(res.json().text, /1\. Solde/, "redemande le menu start");
  });

  it("session inconnue (jamais créée) avec sessionId fourni : repart de start plutôt que d'échouer", async () => {
    const res = await dial({ sessionId: "jamais-vu", text: "1" });
    assert.equal(res.statusCode, 200);
    assert.match(res.json().text, /1\. Solde/);
  });

  it("renseigne request.hifrica (channel: ussd) pour que la console (C4) journalise l'échange", async () => {
    capturedContexts.length = 0;
    const start = await dial({});
    const sessionId = start.json().sessionId as string;
    await dial({ sessionId, text: "1" });

    assert.equal(capturedContexts.length, 2);
    for (const ctx of capturedContexts) {
      const c = ctx as { simulator: string; channel: string; projectId: string; endpointId: string };
      assert.equal(c.simulator, "mobile-money-ussd");
      assert.equal(c.channel, "ussd");
      assert.equal(c.projectId, "demo");
    }
    // endpointId porte le menu de chaque échange, faute d'« endpoint » en USSD.
    assert.equal((capturedContexts[0] as { endpointId: string }).endpointId, "start");
    assert.equal((capturedContexts[1] as { endpointId: string }).endpointId, "pin_balance");
  });

  it("saisie de plus de 182 caractères → 400, pas de session créée", async () => {
    const res = await dial({ text: "x".repeat(183) });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), { error: "input_too_long" });
  });

  it("182 caractères exactement est accepté", async () => {
    const start = await dial({});
    const sessionId = start.json().sessionId as string;
    const res = await dial({ sessionId, text: "1".repeat(182) }); // ne correspond à rien dans `on` → redemande start
    assert.equal(res.statusCode, 200);
  });
});

describe("moteur USSD — troncature défensive du texte rendu", { skip: !process.env.TEST_VALKEY_URL }, () => {
  const url = process.env.TEST_VALKEY_URL as string;
  let app: FastifyInstance;

  // Simulateur construit en mémoire : un gabarit {{var}} peut faire dépasser 182 caractères même si
  // le texte du YAML et la saisie de l'utilisateur sont chacun dans la limite.
  const LONG_VALUE = "a".repeat(180); // ≤ 182 (accepté en saisie), mais "Valeur : " + 180 > 182 une fois rendu.
  const simulatorWithLongTemplate: Simulator = {
    name: "long-template-ussd",
    kind: "ussd",
    code: "*999#",
    menus: {
      start: { text: "Entrez une valeur", input: "v", next: "echo" },
      echo: { text: "Valeur : {{v}}", end: true },
    },
  };

  before(async () => {
    app = Fastify({ logger: false });
    app.decorateRequest("hifrica", null);
    registerValkey(app, { VALKEY_URL: url });
    registerUssd(app, new Map([[simulatorWithLongTemplate.name, simulatorWithLongTemplate]]));
    await app.ready();
    await waitFor(() => sharedValkey()?.status === "ready");
  });

  after(async () => {
    await app.close();
  });

  it("le texte rendu ne dépasse jamais 182 caractères, même après substitution d'un gabarit", async () => {
    const start = await app.inject({ method: "POST", url: "/long-template-ussd/ussd", headers: AUTH, payload: {} });
    const sessionId = start.json().sessionId as string;
    const res = await app.inject({
      method: "POST",
      url: "/long-template-ussd/ussd",
      headers: AUTH,
      payload: { sessionId, text: LONG_VALUE },
    });
    const body = res.json();
    assert.ok(body.text.length <= 182, `texte de ${body.text.length} caractères, attendu ≤ 182`);
    assert.ok(body.text.startsWith("Valeur : "));
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("condition jamais remplie");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
