import Fastify from "fastify";
import { validateSimulatorYaml } from "@hifrica/shared";
import { aiRoutes } from "./ai/routes.js";
import { runMigrations } from "@hifrica/db";

// trustProxy : on ne fait confiance qu'au premier saut (Caddy) ; req.ip est alors l'IP du client lue dans X-Forwarded-For.
const app = Fastify({ logger: true, bodyLimit: 128 * 1024, trustProxy: (_address, hop) => hop === 0 });

app.register(aiRoutes);

app.get("/api/health", async () => ({ status: "ok", service: "api" }));

// Valide un YAML de simulateur sans le publier (utilisé par l'éditeur et par l'assistant IA).
app.post<{ Body: { yaml?: string } }>("/api/simulators/validate", async (req, reply) => {
  const source = req.body?.yaml;
  if (typeof source !== "string") {
    return reply.code(400).send({ error: "Champ 'yaml' manquant." });
  }
  const result = validateSimulatorYaml(source);
  return reply.code(result.valid ? 200 : 422).send({ valid: result.valid, errors: result.errors });
});

async function start() {
  // La base se crée et se met à jour seule au démarrage (C1). Seule DATABASE_URL est requise ici :
  // en production, docker-compose la fournit toujours. Sans elle (dev local sans base), on démarre sans migrer.
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    await runMigrations({ databaseUrl, log: (message) => app.log.info(message) });
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
