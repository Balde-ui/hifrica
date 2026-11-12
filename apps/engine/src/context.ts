// Propriétaire : Dev A
// Contexte Hifrica attaché à chaque requête, rempli au fil de la route et lu par les crochets (logs.ts).

export interface HifricaRequestContext {
  simulator: string;
  channel: "http" | "ussd" | "sms";
  projectId?: string;
  apiKeyId?: string; // id de la clé en base (rempli par C3), JAMAIS la clé elle-même
  endpointId?: string;
  scenarioKey?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    /** null tant que le simulateur n'est pas identifié (/health, simulateur inconnu). */
    hifrica: HifricaRequestContext | null;
  }
}
