// Options Better Auth qui déterminent le SCHÉMA de la base.
// Source unique : utilisées par le CLI de génération (auth.cli.mjs) et, en C2, par l'API.
// Toute option qui change une table Better Auth doit être déclarée ici, jamais dans le fichier généré.
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";

/** Rôles possibles d'un utilisateur. Le rôle n'est jamais accepté depuis une requête (input: false). */
export const USER_ROLES = ["user", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Les tables Better Auth sont nommées au pluriel : users, sessions, accounts, verifications. */
export const AUTH_USE_PLURAL = true;

/**
 * Plugin sans endpoint : ajoute au schéma généré les index que Better Auth ne crée pas.
 * - Un compte OAuth (provider_id, account_id) ne peut être rattaché qu'une fois.
 */
export function hifricaSchemaPlugin(): BetterAuthPlugin {
  return {
    id: "hifrica-schema",
    schema: {
      account: {
        fields: {},
        indexes: [{ fields: ["providerId", "accountId"], unique: true, name: "accounts_provider_account_uidx" }],
      },
    },
  };
}

export const authSchemaOptions = {
  advanced: { database: { generateId: "uuid" } },
  user: {
    additionalFields: {
      role: { type: ["user", "admin"], required: true, defaultValue: "user", input: false },
      // Code pays ISO 3166-1 alpha-2, validé par l'application (pas de CHECK en base).
      country: { type: "string", required: false },
    },
  },
  plugins: [hifricaSchemaPlugin()],
} satisfies Partial<BetterAuthOptions>;
