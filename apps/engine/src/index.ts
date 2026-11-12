import Fastify from "fastify";
import { setTimeout as sleep } from "node:timers/promises";
import { conditionHolds, loadSimulators, matchPath } from "./simulators.js";
import { parseDelay, render } from "./template.js";

const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });
const simulators = loadSimulators(process.env.SIMULATORS_DIR ?? "/simulators", (m) => app.log.info(m));

app.get("/health", async () => ({ status: "ok", service: "engine", simulators: [...simulators.keys()] }));

// Point d'entrée de tous les simulateurs : https://sim.<domaine>/<simulateur>/<chemin déclaré dans le YAML>
app.all<{ Params: { simulator: string; "*": string } }>("/:simulator/*", async (req, reply) => {
  const sim = simulators.get(req.params.simulator);
  if (!sim || sim.kind !== "http") return reply.code(404).send({ error: "simulator_not_found" });

  // Clé de test obligatoire. TODO (Dev C) : vérifier la clé hachée en base et le projet associé.
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer sk_test_")) return reply.code(401).send({ error: "invalid_test_key" });

  const path = "/" + req.params["*"];
  for (const endpoint of sim.endpoints ?? []) {
    if (endpoint.method !== req.method) continue;
    const params = matchPath(endpoint.path, path);
    if (!params) continue;

    const ctx = {
      body: (req.body ?? {}) as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      params,
    };

    // Scénario actif. TODO (Dev C) : lire le scénario actif du projet en base ; en attendant, en-tête de test.
    const scenarioKey = req.headers["x-hifrica-scenario"];
    const scenario = typeof scenarioKey === "string" ? sim.scenarios?.[scenarioKey] : undefined;
    let response = endpoint.response;
    if (scenario && scenario.endpoint === endpoint.id) {
      const matches = Object.entries(scenario.match ?? {}).every(([field, expected]) => {
        const [root, key] = field.split(".");
        const source = root === "body" ? ctx.body : root === "query" ? ctx.query : {};
        return conditionHolds(expected, source[key]);
      });
      if (matches) {
        await sleep(parseDelay(scenario.delay));
        if (scenario.response) response = scenario.response;
      }
    }

    // TODO (Dev A) : webhooks différés signés HMAC via BullMQ ; TODO (Dev B) : événements vers le téléphone simulé.
    return reply.code(response.status).headers(response.headers ?? {}).send(render(response.body ?? {}, ctx));
  }
  return reply.code(404).send({ error: "endpoint_not_found", path });
});

const port = Number(process.env.PORT ?? 4000);
app.listen({ host: "0.0.0.0", port }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
