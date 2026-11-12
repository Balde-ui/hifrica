// Propriétaire : Dev A
// Appels aux fournisseurs d'IA par leur API REST (fetch), sans SDK. Les clés ne sont jamais loguées.

export type ProviderName = "deepseek" | "gemini";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Provider {
  name: ProviderName;
  /** Renvoie le YAML extrait de la réponse json {"yaml": "..."} du modèle. */
  complete(system: string, messages: ChatMessage[]): Promise<string>;
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
const MAX_OUTPUT_TOKENS = 8192;

type Env = Record<string, string | undefined>;

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

function deepseek(apiKey: string, model: string, fetchImpl: typeof fetch): Provider {
  return {
    name: "deepseek",
    async complete(system, messages) {
      const data = await postJson(
        "deepseek",
        fetchImpl,
        "https://api.deepseek.com/chat/completions",
        { Authorization: `Bearer ${apiKey}` },
        {
          model,
          messages: [{ role: "system", content: system }, ...messages],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: MAX_OUTPUT_TOKENS,
          // Le mode réflexion est activé par défaut sur les modèles V4 ; il ignore temperature et ralentit.
          thinking: { type: "disabled" },
          stream: false,
        },
      );
      const content = (data as { choices?: { message?: { content?: string | null } }[] })?.choices?.[0]?.message
        ?.content;
      return extractYaml("deepseek", content);
    },
  };
}

function gemini(apiKey: string, model: string, fetchImpl: typeof fetch): Provider {
  // thinkingLevel n'existe qu'à partir de Gemini 3 (erreur sur les modèles 2.x).
  const thinkingConfig = /^gemini-([3-9]|\d{2,})/.test(model) ? { thinkingConfig: { thinkingLevel: "low" } } : {};
  return {
    name: "gemini",
    async complete(system, messages) {
      const data = await postJson(
        "gemini",
        fetchImpl,
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { "x-goog-api-key": apiKey },
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
            maxOutputTokens: MAX_OUTPUT_TOKENS * 2, // la réflexion consomme une partie du budget
            ...thinkingConfig,
          },
        },
      );
      const parts = (data as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] })
        ?.candidates?.[0]?.content?.parts;
      const text = parts?.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
      return extractYaml("gemini", text);
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
