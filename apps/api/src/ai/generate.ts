// Propriétaire : Dev A
// Boucle génération → validation (JSON Schema partagé) → correction, avec bascule de fournisseur.
import { validateSimulatorYaml } from "@hifrica/shared";
import { buildCorrectionPrompt, type SimulatorKind } from "./prompt.js";
import {
  GenerationAbortedError,
  ProviderError,
  type CallContext,
  type ChatMessage,
  type Provider,
  type ProviderLogger,
  type ProviderName,
} from "./providers.js";

export const MAX_ATTEMPTS = 3; // 1 génération + 2 corrections (les réessais sur réponse vide ne comptent pas)

export interface GenerateResult {
  valid: boolean;
  yaml: string;
  errors: string[];
  provider: ProviderName;
  attempts: number;
}

/** Aucun fournisseur n'a pu produire de YAML (tous en erreur ou non configurés). */
export class AiUnavailableError extends Error {
  constructor() {
    super("ai_unavailable");
    this.name = "AiUnavailableError";
  }
}

export interface GenerateOptions {
  providers: Provider[];
  system: string;
  userPrompt: string;
  kind?: SimulatorKind;
  /** Appelé à chaque échec de fournisseur (nom + raison courte uniquement). */
  onProviderError?: (provider: ProviderName, reason: string) => void;
  /** Logger de la requête, transmis aux fournisseurs (métadonnées d'appel uniquement). */
  log?: ProviderLogger;
  /** Annulation et budget d'appels de la requête (sans : illimité, jamais annulé). */
  ctx?: CallContext;
}

function validate(yaml: string, kind?: SimulatorKind): string[] {
  const result = validateSimulatorYaml(yaml);
  if (!result.valid) return result.errors;
  const actual = (result.simulator as { kind?: unknown }).kind;
  if (kind && actual !== kind) return [`/kind doit valoir "${kind}" (demandé par l'utilisateur), reçu "${String(actual)}"`];
  return [];
}

export async function generateSimulator(opts: GenerateOptions): Promise<GenerateResult> {
  const { providers, system, userPrompt, kind, onProviderError, log, ctx } = opts;
  if (providers.length === 0) throw new AiUnavailableError();

  const messages: ChatMessage[] = [{ role: "user", content: userPrompt }];
  let current = 0; // index du fournisseur en cours ; on ne revient jamais en arrière
  let last: GenerateResult | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let yaml: string | undefined;
    while (current < providers.length) {
      const provider = providers[current];
      try {
        yaml = await provider.complete(system, messages, log, ctx);
        break;
      } catch (err) {
        if (err instanceof GenerationAbortedError) {
          // Client parti ou échéance : on arrête tout, l'appelant répond (ou non).
          if (err.reason !== "call_limit") throw err;
          // Budget d'appels épuisé : on rend le dernier YAML obtenu s'il existe.
          onProviderError?.(provider.name, "call_limit");
          if (last) return last;
          throw new AiUnavailableError();
        }
        onProviderError?.(provider.name, err instanceof ProviderError ? err.reason : "error");
        current++;
      }
    }
    // Tous les fournisseurs ont échoué : on rend le dernier YAML obtenu s'il existe.
    if (yaml === undefined) {
      if (last) return last;
      throw new AiUnavailableError();
    }

    const provider = providers[current].name;
    const errors = validate(yaml, kind);
    if (errors.length === 0) return { valid: true, yaml, errors: [], provider, attempts: attempt };

    last = { valid: false, yaml, errors, provider, attempts: attempt };
    // Correction auprès du même fournisseur : on lui renvoie sa réponse, les erreurs et le YAML fautif.
    messages.push({ role: "assistant", content: JSON.stringify({ yaml }) });
    messages.push({ role: "user", content: buildCorrectionPrompt(yaml, errors) });
  }
  return last as GenerateResult;
}
