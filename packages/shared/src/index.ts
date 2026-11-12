import { Ajv } from "ajv";
import { parse } from "yaml";
import { simulatorSchema } from "./schema.js";

export { simulatorSchema };
export * from "./events.js";

export const MAX_YAML_BYTES = 64 * 1024;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  simulator?: unknown;
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validateSimulator = ajv.compile(simulatorSchema);

/** Lit un YAML de simulateur et le valide contre le schéma partagé. */
export function validateSimulatorYaml(source: string): ValidationResult {
  // TextEncoder plutôt que Buffer : le même code tourne dans le navigateur (éditeur) et dans Node.
  if (new TextEncoder().encode(source).length > MAX_YAML_BYTES) {
    return { valid: false, errors: ["Le fichier dépasse 64 Ko."] };
  }
  let data: unknown;
  try {
    // Mode sûr : pas de types personnalisés, alias limités.
    data = parse(source, { maxAliasCount: 50 });
  } catch (err) {
    return { valid: false, errors: [`YAML illisible : ${(err as Error).message}`] };
  }
  if (validateSimulator(data)) {
    return { valid: true, errors: [], simulator: data };
  }
  const errors = (validateSimulator.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "invalide"}`,
  );
  return { valid: false, errors };
}
