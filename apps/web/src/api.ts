// Client des API réelles de la plateforme (/api, même origine, cookie de session Better Auth).
// Aucune donnée inventée : toute erreur du serveur est remontée telle quelle (message lisible).

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const FALLBACK: Record<number, string> = {
  400: "Requête invalide.",
  401: "Session expirée : reconnectez-vous.",
  404: "Introuvable.",
  409: "Conflit : cette valeur existe déjà.",
  422: "Contenu invalide.",
  429: "Trop de requêtes : réessayez dans un instant.",
  502: "Service de simulation injoignable.",
  503: "Service temporairement indisponible.",
  504: "Le service a mis trop de temps à répondre.",
};

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      signal: init.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network", "Connexion au serveur impossible. Vérifiez votre réseau.");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string; code?: string };
    const code = d.code ?? d.error ?? `http_${res.status}`;
    throw new ApiError(res.status, String(code), d.message ?? FALLBACK[res.status] ?? `Erreur ${res.status}.`, data);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Erreur inattendue.";
}

// ---- Types des réponses (contrats de apps/api/src/platform.ts) ----

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  webhookUrl: string | null;
  createdAt: string;
  activeKeys: number;
}

export interface ApiKeyView {
  id: string;
  name: string | null;
  display: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ProjectDetail {
  project: { id: string; name: string; webhookUrl: string | null; createdAt: string };
  keys: ApiKeyView[];
  scenarios: Record<string, string | null>;
}

export interface SimulatorSummary {
  slug: string;
  kind: "http" | "ussd";
  description: string | null;
  origin: "manual" | "ai";
  status: "draft" | "to_verify" | "verified" | "unpublished";
  version: string | null;
  endpoints: { id: string; method: string; path: string }[];
  scenarios: string[];
  menus: number;
  code: string | null;
  publishedAt: string | null;
  forkedFrom: string | null;
}

export interface LogEntry {
  id: string;
  requestId: string;
  simulator: string;
  channel: "http" | "ussd" | "sms";
  source: string;
  outcome: "responded" | "client_aborted" | "response_failed" | "timeout";
  endpointId: string | null;
  scenarioKey: string | null;
  sessionId: string | null;
  method: string;
  path: string;
  status: number | null;
  errorCode: string | null;
  durationMs: number;
  createdAt: string;
  apiKeyId: string | null;
}

export interface SendResult {
  status: number;
  durationMs: number;
  requestId: string | null;
  contentType: string | null;
  body: unknown;
}

export interface AppConfig {
  engineUrl: string;
  github: boolean;
}

// ---- Clés de test mémorisées pour la session du navigateur (jamais envoyées ailleurs qu'à /api) ----

const KEY_STORE = "hifrica:test-keys";

export function rememberKey(projectId: string, key: string): void {
  try {
    const all = JSON.parse(sessionStorage.getItem(KEY_STORE) ?? "{}") as Record<string, string>;
    all[projectId] = key;
    sessionStorage.setItem(KEY_STORE, JSON.stringify(all));
  } catch {
    /* stockage indisponible : la clé reste à coller à la main */
  }
}

export function rememberedKey(projectId: string): string {
  try {
    return (JSON.parse(sessionStorage.getItem(KEY_STORE) ?? "{}") as Record<string, string>)[projectId] ?? "";
  } catch {
    return "";
  }
}

export function forgetKeys(): void {
  try {
    sessionStorage.removeItem(KEY_STORE);
  } catch {
    /* rien */
  }
}
