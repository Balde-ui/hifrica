// Configuration Better Auth réservée au CLI de génération du schéma (`auth generate`).
// Aucune connexion à la base (drizzle.mock()), aucun secret : seules les options de schéma comptent.
// Lit les options compilées : lancer `tsc` avant (les scripts db:auth:* le font).
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { AUTH_USE_PLURAL, authSchemaOptions } from "./dist/auth/options.js";

export const auth = betterAuth({
  ...authSchemaOptions,
  database: drizzleAdapter(drizzle.mock(), { provider: "pg", usePlural: AUTH_USE_PLURAL }),
  emailAndPassword: { enabled: true },
  telemetry: { enabled: false },
});
