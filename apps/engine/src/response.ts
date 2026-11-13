// Propriétaire : Dev A
// Construction de la réponse d'un endpoint : recherche, scénario, délai (plafonné à 30 s), gabarits,
// et événement payment.pending dérivé de la réponse.
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { DEFAULT_CURRENCY, type PaymentPendingEvent, type SmsReceivedEvent } from "@hifrica/shared";
import { conditionHolds, matchPath, type Endpoint, type Simulator } from "./simulators.js";
import { parseDelay, render, type TemplateContext } from "./template.js";

export interface RenderedResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Premier endpoint du simulateur qui correspond à la méthode et au chemin reçus. */
export function findEndpoint(
  sim: Simulator,
  method: string,
  path: string,
): { endpoint: Endpoint; params: Record<string, string> } | undefined {
  for (const endpoint of sim.endpoints ?? []) {
    if (endpoint.method !== method) continue;
    const params = matchPath(endpoint.path, path);
    if (params) return { endpoint, params };
  }
  return undefined;
}

/** Applique le scénario (s'il vise cet endpoint et que ses conditions tiennent), attend le délai, rend la réponse. */
export async function buildResponse(
  sim: Simulator,
  endpoint: Endpoint,
  scenarioKey: string | undefined,
  ctx: TemplateContext,
): Promise<RenderedResponse> {
  const scenario =
    scenarioKey !== undefined && sim.scenarios && Object.hasOwn(sim.scenarios, scenarioKey)
      ? sim.scenarios[scenarioKey]
      : undefined;
  let response = endpoint.response;
  if (scenario && scenario.endpoint === endpoint.id) {
    const matches = Object.entries(scenario.match ?? {}).every(([field, expected]) => {
      const [root, key] = field.split(".");
      const source = root === "body" ? ctx.body : root === "query" ? ctx.query : {};
      return conditionHolds(expected, source[key]);
    });
    if (matches) {
      await sleep(parseDelay(scenario.delay));
      if (scenario.response) response = scenario.response;
    }
  }
  return { status: response.status, headers: response.headers ?? {}, body: render(response.body ?? {}, ctx) };
}

/**
 * Événement payment.pending pour un endpoint à bloc phone (écran confirm-payment).
 * Renvoie undefined si la réponse ne contient pas d'id de checkout ou si le montant n'est pas un nombre.
 */
export function paymentPendingEvent(args: {
  projectId: string;
  simulator: string;
  endpoint: Endpoint;
  ctx: TemplateContext;
  response: RenderedResponse;
  /** X-Hifrica-Request-Id de la requête (corrélation requête → paiement → webhook). */
  requestId?: string;
}): PaymentPendingEvent | undefined {
  const { projectId, simulator, endpoint, ctx, response, requestId } = args;
  const phone = endpoint.phone;
  if (!phone || (phone.screen ?? "confirm-payment") !== "confirm-payment") return undefined;

  const resBody = isRecord(response.body) ? response.body : {};
  const id = resBody.id;
  if ((typeof id !== "string" || id === "") && typeof id !== "number") return undefined;

  const rawAmount = ctx.body.amount ?? resBody.amount;
  const amount =
    typeof rawAmount === "number" ? rawAmount
    : typeof rawAmount === "string" && rawAmount.trim() !== "" ? Number(rawAmount)
    : Number.NaN;
  if (!Number.isFinite(amount)) return undefined;

  const currency = typeof resBody.currency === "string" ? resBody.currency
    : typeof ctx.body.currency === "string" ? ctx.body.currency
    : DEFAULT_CURRENCY;
  const merchant = typeof ctx.body.merchant === "string" ? ctx.body.merchant : undefined;

  return {
    type: "payment.pending",
    sessionId: String(id),
    projectId,
    simulator,
    endpointId: endpoint.id,
    amount,
    currency,
    ...(merchant !== undefined ? { merchant } : {}),
    screen: "confirm-payment",
    text: String(render(phone.text ?? "", ctx)),
    createdAt: new Date().toISOString(),
    ...(requestId !== undefined ? { requestId } : {}),
  };
}

/**
 * Événement sms.received pour un endpoint à bloc phone (écran sms). Contrairement au paiement, aucune
 * session n'est créée : c'est une notification à sens unique, publiée directement après la réponse.
 * Renvoie undefined si l'écran n'est pas "sms", ou si from/to/text manquent (le schéma les impose déjà
 * à la validation du YAML ; ce contrôle protège un simulateur chargé avant une mise à jour du schéma).
 */
export function smsReceivedEvent(args: {
  projectId: string;
  endpoint: Endpoint;
  ctx: TemplateContext;
  /** X-Hifrica-Request-Id de la requête (corrélation requête → SMS → console). */
  requestId?: string;
}): SmsReceivedEvent | undefined {
  const { projectId, endpoint, ctx, requestId } = args;
  const phone = endpoint.phone;
  if (!phone || phone.screen !== "sms" || !phone.from || !phone.to || !phone.text) return undefined;

  return {
    type: "sms.received",
    messageId: randomUUID(),
    projectId,
    from: String(render(phone.from, ctx)),
    to: String(render(phone.to, ctx)),
    text: String(render(phone.text, ctx)),
    createdAt: new Date().toISOString(),
    ...(requestId !== undefined ? { requestId } : {}),
  };
}
