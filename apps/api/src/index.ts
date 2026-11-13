import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { validateSimulatorYaml } from "@hifrica/shared";
import { aiRoutes } from "./ai/routes.js";
import { createDb, createPool, parseWebhookSecretKeyring, runMigrations, type WebhookSecretKeyring } from "@hifrica/db";
import { createAuth, registerAuthRoutes, setAuthContext } from "./auth.js";
import { registerPlatformRoutes, seedSimulators } from "./platform.js";
import { registerSse } from "./sse.js";

// trustProxy : on ne fait confiance qu'au premier saut (Caddy) ; req.ip est alors l'IP du client lue dans X-Forwarded-For.
const app = Fastify({ logger: true, bodyLimit: 128 * 1024, trustProxy: (_address, hop) => hop === 0 });

app.register(aiRoutes);

app.get("/api/health", async () => ({ status: "ok", service: "api" }));

registerSse(app);

// Valide un YAML de simulateur sans le publier (utilisé par l'éditeur et par l'assistant IA).
app.post<{ Body: { yaml?: string } }>("/api/simulators/validate", async (req, reply) => {
  const source = req.body?.yaml;
  if (typeof source !== "string") {
    return reply.code(400).send({ error: "Champ 'yaml' manquant." });
  }
  const result = validateSimulatorYaml(source);
  return reply.code(result.valid ? 200 : 422).send({ valid: result.valid, errors: result.errors });
});

/** Simulateurs livrés avec le dépôt (copiés dans l'image Docker de l'API). */
const DEFAULT_SIMULATORS_DIR = fileURLToPath(new URL("../../../simulators", import.meta.url));

function loadKeyring(): WebhookSecretKeyring | null {
  if (!process.env.WEBHOOK_SECRET_KEYS) return null;
  try {
    return parseWebhookSecretKeyring(process.env.WEBHOOK_SECRET_KEYS);
  } catch {
    app.log.error("WEBHOOK_SECRET_KEYS invalide : création de projets désactivée");
    return null;
  }
}

async function start() {
  // La base se crée et se met à jour seule au démarrage (C1). Seule DATABASE_URL est requise ici :
  // en production, docker-compose la fournit toujours. Sans elle (dev local sans base), on démarre sans migrer.
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    await runMigrations({ databaseUrl, log: (message) => app.log.info(message) });
    const pool = createPool(databaseUrl, { applicationName: "hifrica-api" });
    // Une connexion inactive coupée (redémarrage de PostgreSQL) ne doit pas arrêter l'API.
    pool.on("error", (err: Error & { code?: string }) => app.log.warn({ code: err.code }, "connexion PostgreSQL perdue"));
    const db = createDb(pool);
    app.addHook("onClose", async () => pool.end());

    await seedSimulators(db, process.env.SIMULATORS_DIR ?? DEFAULT_SIMULATORS_DIR, (m) => app.log.info(m));

    const keyring = loadKeyring();
    if (!keyring) app.log.warn("WEBHOOK_SECRET_KEYS absente : création de projets désactivée");

    // Comptes : sans BETTER_AUTH_SECRET ni BETTER_AUTH_URL, l'API démarre mais les routes authentifiées répondent 401.
    if (process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_URL) {
      const auth = createAuth(db, process.env, app.log);
      setAuthContext(auth, db);
      registerAuthRoutes(app, auth, process.env.BETTER_AUTH_URL);
    } else {
      app.log.error("BETTER_AUTH_SECRET ou BETTER_AUTH_URL absente : comptes désactivés");
    }

    registerPlatformRoutes(app, {
      db,
      keyring,
      engineUrl: process.env.ENGINE_INTERNAL_URL ?? "http://engine:4000",
      publicEngineUrl: process.env.ENGINE_PUBLIC_URL ?? (process.env.SIM_DOMAIN ? `https://${process.env.SIM_DOMAIN}` : "http://localhost:4000"),
      simulatorsDir: process.env.SIMULATORS_DIR ?? DEFAULT_SIMULATORS_DIR,
    });
  } else {
    app.log.warn("DATABASE_URL absente : migrations non exécutées (développement local sans base).");
  }
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ host: "0.0.0.0", port });
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
