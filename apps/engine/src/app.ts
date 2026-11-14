// Construction du moteur de simulation (routes et crochets), sans écoute réseau : voir index.ts.
import { randomUUID } from "node:crypto";
import { isSlug } from "@hifrica/db";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import { authenticate, resolveScenario } from "./auth.js";
import { appPublicUrl, catalogueUrl, homeDocument, isBrowserRequest, redirectBrowser } from "./browser.js";
import { createCatalog, isEngineUnavailable, isInvalidTestKey, type CatalogOptions } from "./catalog.js";
import type { HifricaRequestContext } from "./context.js";
import { registerConfirmations } from "./confirmations.js";
import { publishEvent } from "./events.js";
import { registerRequestLogging } from "./logs.js";
import { startPaymentSession } from "./phone-session.js";
import { buildResponse, findEndpoint, paymentPendingEvent, smsReceivedEvent } from "./response.js";
import { loadSimulators, type Simulator } from "./simulators.js";
import { parseDelay, render } from "./template.js";
import { registerUssd } from "./ussd.js";
import { registerValkey } from "./valkey.js";
import { registerWebhooks, scheduleWebhook } from "./webhooks.js";

type Env = Record<string, string | undefined>;

export interface BuildAppOptions {
  /** Simulateurs ; par défaut lus dans SIMULATORS_DIR (ou /simulators). */
  simulators?: Map<string, Simulator>;
  /** Variables d'environnement (par défaut process.env) ; injectables pour les tests. */
  env?: Env;
  logger?: FastifyServerOptions["logger"];
  /** Accès aux simulateurs publiés (base, horloge du cache) ; remplaçable dans les tests. */
  catalog?: Pick<CatalogOptions, "getDb" | "fetchPublished" | "now">;
}

/** Construit le moteur sans l'écouter : utilisé par index.ts et par les tests. */
export function buildApp({ simulators: given, env = process.env, logger = true, catalog: catalogOptions }: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger, bodyLimit: 64 * 1024, genReqId: () => randomUUID() });
  const appUrl = appPublicUrl(env);

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Hifrica-Request-Id", request.id);
    return payload;
  });
  // Contexte Hifrica de la requête, rempli par la route et lu par les crochets de logs.ts.
  app.decorateRequest("hifrica", null);
  registerRequestLogging(app);
  // Connexions Valkey : enregistrées EN PREMIER pour être fermées EN DERNIER (onClose s'exécute à rebours).
  registerValkey(app, env);
  // File BullMQ et Worker des webhooks, fermés avec Fastify (onClose).
  registerWebhooks(app, env);

  const simulators = given ?? loadSimulators(env.SIMULATORS_DIR ?? "/simulators", (m) => app.log.info(m));
  // Fichiers de simulators/ d'abord, puis simulateurs publiés depuis l'éditeur (catalog.ts, avec cache).
  const catalog = createCatalog({ files: simulators, log: app.log.child({ component: "catalog" }), ...catalogOptions });
  /**
   * Simulateur du slug pour la requête d'un client : null s'il n'existe pas, "unavailable" si la base ne
   * répond pas, "invalid_key" si le slug n'est pas un fichier et que la clé est absente ou mal formée
   * (aucune lecture en base dans ce cas). Les fichiers de simulators/ ne passent pas par ce contrôle.
   */
  const resolveForRequest = async (req: FastifyRequest, slug: string): Promise<Simulator | null | "unavailable" | "invalid_key"> => {
    try {
      return await catalog.resolve(slug, req);
    } catch (err) {
      if (isEngineUnavailable(err)) return "unavailable";
      if (isInvalidTestKey(err)) return "invalid_key";
      throw err;
    }
  };
  /**
   * Navigateur, sans aucune lecture en base : un fichier de simulators/ → sa fiche ; tout autre slug valide
   * → /catalogue/<slug> (la fiche dit elle-même s'il est publié) ; sinon le catalogue.
   */
  const redirectToCatalogue = (reply: FastifyReply, slug: string) => {
    const file = simulators.get(slug);
    return redirectBrowser(reply, catalogueUrl(appUrl, file ? file.name : isSlug(slug) ? slug : undefined));
  };
  // A4 : abonnement aux phone.confirm / phone.reject, qui déclenchent les webhooks « on: ».
  registerConfirmations(app, catalog.resolve);

  app.get("/health", async () => ({ status: "ok", service: "engine", simulators: [...simulators.keys()] }));

  // Accueil de sim.<domaine> : un navigateur part vers le catalogue, un programme reçoit le mode d'emploi.
  app.get("/", async (req, reply) => {
    if (isBrowserRequest(req)) return redirectBrowser(reply, catalogueUrl(appUrl));
    return reply.header("Vary", "Accept, Authorization").send(homeDocument(appUrl));
  });

  // /<simulateur> sans chemin : navigateur → fiche du simulateur ; sinon le 404 habituel de Fastify.
  app.get<{ Params: { simulator: string } }>("/:simulator", async (req, reply) => {
    if (!isBrowserRequest(req)) return reply.callNotFound();
    return redirectToCatalogue(reply, req.params.simulator);
  });

  // Point d'entrée de tous les simulateurs : https://sim.<domaine>/<simulateur>/<chemin déclaré dans le YAML>
  app.all<{ Params: { simulator: string; "*": string } }>("/:simulator/*", async (req, reply) => {
    // Navigateur (GET, Accept text/html, sans Authorization) : fiche du simulateur, avant toute authentification.
    if (isBrowserRequest(req)) return redirectToCatalogue(reply, req.params.simulator);
    const sim = await resolveForRequest(req, req.params.simulator);
    // Slug absent des fichiers et clé absente ou mal formée : 401 sans lecture en base.
    if (sim === "invalid_key") return reply.code(401).send({ error: "invalid_test_key" });
    // Base injoignable : le simulateur existe peut-être, on ne répond pas « inconnu ».
    if (sim === "unavailable") return reply.code(503).send({ error: "engine_unavailable" });
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
        const screen = endpoint.phone.screen ?? "confirm-payment";
        if (screen === "confirm-payment") {
          const event = paymentPendingEvent({ projectId, simulator: sim.name, endpoint, ctx, response, requestId: req.id });
          if (event) {
            // A3 : la session est écrite dans Valkey AVANT la publication ; sans session, pas d'événement.
            await startPaymentSession({ event, ctx, response, log: req.log });
          } else {
            req.log.warn({ endpointId: endpoint.id }, "bloc phone sans payment.pending (id ou amount absent)");
          }
        } else if (screen === "sms") {
          // Pas de session (contrairement au paiement) : une notification SMS n'attend aucune réponse du
          // téléphone, elle est publiée directement. {{response.x}} lit ici la réponse déjà rendue (ex.
          // un code de vérification), comme pour le corps d'un webhook.
          const event = smsReceivedEvent({ projectId, endpoint, ctx: { ...ctx, response: response.body }, requestId: req.id });
          if (event) {
            await publishEvent(event, req.log).catch((err: unknown) => req.log.error({ err }, "publishEvent (sms.received) a échoué"));
          } else {
            req.log.warn({ endpointId: endpoint.id }, "bloc phone sms sans from/to/text");
          }
        } else {
          req.log.warn({ endpointId: endpoint.id, screen }, "écran phone non géré");
        }
      }
      // Les webhooks avec "on" (ex. phone.confirm) sont déclenchés par l'événement correspondant (A4, confirmations.ts).
      if (endpoint.webhook && !endpoint.webhook.on) {
        await scheduleWebhook(
          {
            projectId,
            simulator: sim.name,
            requestId: req.id,
            event: endpoint.webhook.event,
            body: render(endpoint.webhook.body ?? {}, { ...ctx, response: response.body }),
            delayMs: parseDelay(endpoint.webhook.after),
          },
          req.log,
        ).catch((err: unknown) => req.log.error({ err }, "scheduleWebhook a échoué"));
      }
    }

    return reply.code(response.status).headers(response.headers).send(response.body);
  });

  registerUssd(app, catalog.resolve);

  return app;
}
