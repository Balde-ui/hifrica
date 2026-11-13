import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { authenticate, resolveScenario } from "./auth.js";
import type { HifricaRequestContext } from "./context.js";
import { publishEvent } from "./events.js";
import { registerRequestLogging } from "./logs.js";
import { buildResponse, findEndpoint, paymentPendingEvent } from "./response.js";
import { loadSimulators } from "./simulators.js";
import { parseDelay, render } from "./template.js";
import { registerUssd } from "./ussd.js";
import { registerWebhooks, scheduleWebhook } from "./webhooks.js";

const app = Fastify({ logger: true, bodyLimit: 64 * 1024, genReqId: () => randomUUID() });

app.addHook("onSend", async (request, reply, payload) => {
  reply.header("X-Hifrica-Request-Id", request.id);
  return payload;
});
// Contexte Hifrica de la requête, rempli par la route et lu par les crochets de logs.ts.
app.decorateRequest("hifrica", null);
registerRequestLogging(app);
// File BullMQ et Worker des webhooks, fermés avec Fastify (onClose).
registerWebhooks(app);

const simulators = loadSimulators(process.env.SIMULATORS_DIR ?? "/simulators", (m) => app.log.info(m));

app.get("/health", async () => ({ status: "ok", service: "engine", simulators: [...simulators.keys()] }));

// Point d'entrée de tous les simulateurs : https://sim.<domaine>/<simulateur>/<chemin déclaré dans le YAML>
app.all<{ Params: { simulator: string; "*": string } }>("/:simulator/*", async (req, reply) => {
  const sim = simulators.get(req.params.simulator);
  if (!sim || sim.kind !== "http") return reply.code(404).send({ error: "simulator_not_found" });
  const hifrica: HifricaRequestContext = { simulator: sim.name, channel: "http" };
  req.hifrica = hifrica;

  const auth = await authenticate(req);
  if (!auth.ok) return reply.code(401).send({ error: "invalid_test_key" });
  const { projectId } = auth;
  hifrica.projectId = projectId;
  if (auth.apiKeyId !== undefined) hifrica.apiKeyId = auth.apiKeyId;

  const path = "/" + req.params["*"];
  const found = findEndpoint(sim, req.method, path);
  if (!found) return reply.code(404).send({ error: "endpoint_not_found", path });
  const { endpoint, params } = found;
  hifrica.endpointId = endpoint.id;

  const ctx = {
    body: (req.body ?? {}) as Record<string, unknown>,
    query: req.query as Record<string, unknown>,
    params,
  };
  const scenarioKey = await resolveScenario(req, projectId);
  if (scenarioKey !== undefined) hifrica.scenarioKey = scenarioKey;
  const response = await buildResponse(sim, endpoint, scenarioKey, ctx);

  // Effets de bord uniquement sur succès : un 402 (solde insuffisant) ne crée ni session ni webhook.
  if (response.status >= 200 && response.status < 300) {
    if (endpoint.phone) {
      const event = paymentPendingEvent({ projectId, simulator: sim.name, endpoint, ctx, response });
      if (event) {
        await publishEvent(event, req.log).catch((err: unknown) => req.log.error({ err }, "publishEvent a échoué"));
      } else {
        req.log.warn({ endpointId: endpoint.id }, "bloc phone sans payment.pending (écran non géré, id ou amount absent)");
      }
    }
    // Les webhooks avec "on" (ex. phone.confirm) seront déclenchés par l'événement correspondant (A4).
    if (endpoint.webhook && !endpoint.webhook.on) {
      await scheduleWebhook(
        {
          projectId,
          simulator: sim.name,
          requestId: req.id,
          event: endpoint.webhook.event,
          body: render(endpoint.webhook.body ?? {}, ctx),
          delayMs: parseDelay(endpoint.webhook.after),
        },
        req.log,
      ).catch((err: unknown) => req.log.error({ err }, "scheduleWebhook a échoué"));
    }
  }

  return reply.code(response.status).headers(response.headers).send(response.body);
});

registerUssd(app, simulators);

const port = Number(process.env.PORT ?? 4000);
app.listen({ host: "0.0.0.0", port }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

// Arrêt propre : Fastify cesse d'accepter des requêtes, puis ses crochets onClose ferment le Worker et la file.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "arrêt du moteur");
    // Filet de sécurité sous le délai de 10 s de docker stop.
    setTimeout(() => process.exit(1), 9_000).unref();
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error(err);
        process.exit(1);
      },
    );
  });
}
