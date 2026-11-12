// Propriétaire : Dev A
// Appels aux fournisseurs d'IA par leur API REST (fetch), sans SDK. Les clés ne sont jamais loguées,
// le contenu des réponses non plus : seulement finish_reason, le nombre de tokens et la taille.
import type { FastifyBaseLogger } from "fastify";

export type ProviderName = "deepseek" | "gemini";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type ProviderLogger = Pick<FastifyBaseLogger, "info" | "warn">;

export interface Provider {
  name: ProviderName;
  /**
   * Renvoie le YAML extrait de la réponse json {"yaml": "..."} du modèle.
   * Une réponse vide ou illisible est réessayée une fois chez le même fournisseur avant d'échouer.
   */
  complete(system: string, messages: ChatMessage[], log?: ProviderLogger): Promise<string>;
}

/** Échec d'un fournisseur. `reason` est court et sans donnée sensible (jamais le corps de la réponse). */
export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly reason: string,
  ) {
    super(`${provider}: ${reason}`);
    this.name = "ProviderError";
  }
}

export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const TIMEOUT_MS = 30_000;
/** DeepSeek : 1 à 384K selon la doc ; 8000 suffit largement pour un simulateur (YAML ≤ 64 Ko). */
const DEEPSEEK_MAX_TOKENS = 8000;
/** Gemini : les tokens de réflexion sont pris sur le même budget que la réponse. */
const GEMINI_MAX_OUTPUT_TOKENS = 16_000;
/** Appels HTTP par essai : 1 + 1 réessai si la réponse est vide ou illisible. */
const CALLS_PER_COMPLETION = 2;

type Env = Record<string, string | undefined>;

const noopLogger: ProviderLogger = { info: () => undefined, warn: () => undefined };

/** Extrait le champ yaml d'une réponse json du modèle ; lève "unreadable" sinon. */
export function extractYaml(provider: ProviderName, text: string | undefined | null): string {
  if (typeof text !== "string" || text.trim() === "") throw new ProviderError(provider, "unreadable");
  // Certains modèles entourent malgré tout le json d'un bloc ```json ... ```.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    throw new ProviderError(provider, "unreadable");
  }
  if (!data || typeof data !== "object" || typeof (data as { yaml?: unknown }).yaml !== "string") {
    throw new ProviderError(provider, "unreadable");
  }
  const yaml = (data as { yaml: string }).yaml;
  if (yaml.trim() === "") throw new ProviderError(provider, "unreadable");
  return yaml;
}

async function postJson(
  provider: ProviderName,
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    throw new ProviderError(provider, name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new ProviderError(provider, `http_${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    throw new ProviderError(provider, "unreadable");
  }
}

/** Résultat d'un appel HTTP : le texte (jamais logué) et des métadonnées sans contenu (loguées). */
interface RawCompletion {
  text: string | undefined;
  meta: Record<string, unknown>;
}

/**
 * Appelle le fournisseur et extrait le YAML. Si la réponse est vide ou illisible (y compris un corps
 * HTTP non json), refait UN appel identique. Les erreurs réseau, timeout et HTTP ne sont pas
 * réessayées ici : elles font passer directement au fournisseur suivant.
 */
async function completeWithRetry(
  provider: ProviderName,
  call: () => Promise<RawCompletion>,
  log: ProviderLogger,
): Promise<string> {
  for (let n = 1; n <= CALLS_PER_COMPLETION; n++) {
    let raw: RawCompletion | undefined;
    try {
      raw = await call();
    } catch (err) {
      const unreadable = err instanceof ProviderError && err.reason === "unreadable";
      if (!unreadable || n === CALLS_PER_COMPLETION) throw err;
      log.warn({ provider, call: n, reason: "unreadable" }, "réponse IA illisible, nouvel essai");
      continue;
    }
    const empty = typeof raw.text !== "string" || raw.text.trim() === "";
    log.info({ provider, call: n, ...raw.meta, empty, contentLength: raw.text?.length ?? 0 }, "appel IA");
    try {
      return extractYaml(provider, raw.text);
    } catch (err) {
      if (n === CALLS_PER_COMPLETION) throw err;
      log.warn({ provider, call: n, reason: empty ? "empty" : "unreadable" }, "réponse IA vide ou illisible, nouvel essai");
    }
  }
  throw new ProviderError(provider, "unreadable"); // inatteignable
}

interface DeepSeekResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

function deepseek(apiKey: string, model: string, fetchImpl: typeof fetch): Provider {
  return {
    name: "deepseek",
    complete(system, messages, log = noopLogger) {
      const body = {
        model,
        messages: [{ role: "system", content: system }, ...messages],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: DEEPSEEK_MAX_TOKENS,
        // Le mode réflexion est activé par défaut sur les modèles V4 ; il ignore temperature et ralentit.
        thinking: { type: "disabled" },
        stream: false,
      };
      return completeWithRetry(
        "deepseek",
        async () => {
          const data = (await postJson("deepseek", fetchImpl, "https://api.deepseek.com/chat/completions", {
            Authorization: `Bearer ${apiKey}`,
          }, body)) as DeepSeekResponse | null;
          const choice = data?.choices?.[0];
          return {
            text: choice?.message?.content ?? undefined,
            meta: {
              finishReason: choice?.finish_reason ?? null,
              promptTokens: data?.usage?.prompt_tokens ?? null,
              completionTokens: data?.usage?.completion_tokens ?? null,
              reasoningTokens: data?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
            },
          };
        },
        log,
      );
    },
  };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
}

function gemini(apiKey: string, model: string, fetchImpl: typeof fetch): Provider {
  // thinkingLevel n'existe qu'à partir de Gemini 3 (erreur sur les modèles 2.x).
  const thinkingConfig = /^gemini-([3-9]|\d{2,})/.test(model) ? { thinkingConfig: { thinkingLevel: "low" } } : {};
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return {
    name: "gemini",
    complete(system, messages, log = noopLogger) {
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
          maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
          ...thinkingConfig,
        },
      };
      return completeWithRetry(
        "gemini",
        async () => {
          const data = (await postJson("gemini", fetchImpl, url, { "x-goog-api-key": apiKey }, body)) as GeminiResponse | null;
          const candidate = data?.candidates?.[0];
          const parts = candidate?.content?.parts;
          const text = parts?.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
          return {
            text,
            meta: {
              finishReason: candidate?.finishReason ?? null,
              blockReason: data?.promptFeedback?.blockReason ?? null,
              promptTokens: data?.usageMetadata?.promptTokenCount ?? null,
              completionTokens: data?.usageMetadata?.candidatesTokenCount ?? null,
              thoughtsTokens: data?.usageMetadata?.thoughtsTokenCount ?? null,
              totalTokens: data?.usageMetadata?.totalTokenCount ?? null,
            },
          };
        },
        log,
      );
    },
  };
}

/** Fournisseurs configurés, dans l'ordre d'essai : DeepSeek (principal) puis Gemini (secours). */
export function createProviders(env: Env = process.env, fetchImpl: typeof fetch = fetch): Provider[] {
  const providers: Provider[] = [];
  if (env.DEEPSEEK_API_KEY) {
    providers.push(deepseek(env.DEEPSEEK_API_KEY, env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL, fetchImpl));
  }
  if (env.GEMINI_API_KEY) {
    providers.push(gemini(env.GEMINI_API_KEY, env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL, fetchImpl));
  }
  return providers;
}
