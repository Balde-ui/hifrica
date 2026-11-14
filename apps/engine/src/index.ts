// Point d'entrée du moteur : construit l'application (app.ts, simulateurs lus dans SIMULATORS_DIR) et l'écoute.
import { buildApp } from "./app.js";

const app = buildApp();
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
