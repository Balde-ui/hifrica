import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { registerSse, resetStreamLimitsForTests, type SseDeps } from "./sse.js";
import { registerValkey, sharedValkey } from "./valkey.js";

const USER = { id: "user-1", email: "u@example.com", name: "U" };
const fakeDeps: SseDeps = {
  requireUser: async () => USER,
  assertProjectOwner: async () => true,
};

/** Ouvre une connexion au flux et résout dès que les en-têtes (200) sont reçus, sans attendre la fin. */
function openStream(port: number): Promise<{ req: http.ClientRequest; status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/projects/demo/stream" }, (res) => {
      resolve({ req, status: res.statusCode ?? 0 });
      res.resume(); // ne bloque jamais sur le corps : on ne lit pas les événements dans ce test.
    });
    req.on("error", reject);
  });
}

describe("GET /api/projects/:id/stream — limite de connexions (avec un vrai Valkey, TEST_VALKEY_URL)", {
  skip: !process.env.TEST_VALKEY_URL,
}, () => {
  const url = process.env.TEST_VALKEY_URL as string;
  let app: FastifyInstance;
  let port: number;

  before(async () => {
    // sse.ts lit process.env.VALKEY_URL directement (pas l'état interne de valkey.ts) pour décider
    // s'il répond 503 : il faut donc la vraie variable d'environnement, pas seulement l'argument
    // passé à registerValkey (qui ne configure que le client partagé).
    process.env.VALKEY_URL = url;
    app = Fastify({ logger: false });
    registerValkey(app, { VALKEY_URL: url });
    registerSse(app, fakeDeps);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("adresse du serveur introuvable");
    port = address.port;
    await waitFor(() => sharedValkey()?.status === "ready");
  });

  after(async () => {
    await app.close();
  });

  it("limite à 5 flux simultanés pour le même utilisateur, 429 au-delà, libéré à la fermeture", async () => {
    resetStreamLimitsForTests();
    const opened: http.ClientRequest[] = [];
    try {
      for (let i = 0; i < 5; i++) {
        const { req, status } = await openStream(port);
        assert.equal(status, 200, `connexion ${i + 1}/5 devrait réussir`);
        opened.push(req);
      }

      const sixth = await openStream(port);
      assert.equal(sixth.status, 429);
      sixth.req.destroy();

      // Ferme les 5 premières : chaque fermeture doit libérer sa place.
      for (const req of opened) req.destroy();
      await waitFor(async () => {
        const retry = await openStream(port);
        retry.req.destroy();
        return retry.status === 200;
      });
    } finally {
      for (const req of opened) req.destroy();
    }
  });

  it("une déconnexion juste après l'ouverture (pendant connect()/subscribe()) ne fait pas planter le serveur", async () => {
    resetStreamLimitsForTests();
    const { req } = await openStream(port);
    req.destroy(); // coupe tout de suite, avant même que le client n'ait pu lire le premier octet.

    // Si le nettoyage avait écrit sur un socket détruit sans protection, ce test suivant échouerait
    // (processus mort) plutôt que de simplement recevoir une réponse normale.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const after1 = await openStream(port);
    assert.equal(after1.status, 200);
    after1.req.destroy();
  });
});

async function waitFor(condition: () => Promise<boolean> | boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeoutMs) throw new Error("condition jamais remplie");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
