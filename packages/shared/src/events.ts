// Événements temps réel échangés entre le moteur, l'API et le téléphone simulé (canal Valkey par projet).

export const DEFAULT_CURRENCY = "XOF";

interface BaseEvent {
  createdAt: string;
}

export interface PaymentPendingEvent extends BaseEvent {
  type: "payment.pending";
  sessionId: string;
  projectId: string;
  simulator: string;
  endpointId: string;
  amount: number;
  currency?: string;
  merchant?: string;
  screen: "confirm-payment";
  text: string;
}

export interface PhoneConfirmEvent extends BaseEvent {
  type: "phone.confirm";
  sessionId: string;
  projectId: string;
  pin?: string;
}

export interface PhoneRejectEvent extends BaseEvent {
  type: "phone.reject";
  sessionId: string;
  projectId: string;
  reason?: string;
}

export interface SmsReceivedEvent extends BaseEvent {
  type: "sms.received";
  messageId: string;
  projectId: string;
  from: string;
  to: string;
  text: string;
}

export interface UssdScreenEvent extends BaseEvent {
  type: "ussd.screen";
  sessionId: string;
  projectId: string;
  text: string;
  end: boolean;
}

export interface UssdInputEvent extends BaseEvent {
  type: "ussd.input";
  sessionId: string;
  projectId: string;
  input: string;
}

export interface UssdEndEvent extends BaseEvent {
  type: "ussd.end";
  sessionId: string;
  projectId: string;
  reason: "completed" | "timeout" | "cancelled";
}

export type HifricaEvent =
  | PaymentPendingEvent
  | PhoneConfirmEvent
  | PhoneRejectEvent
  | SmsReceivedEvent
  | UssdScreenEvent
  | UssdInputEvent
  | UssdEndEvent;

export type HifricaEventType = HifricaEvent["type"];

/** Nom du canal Valkey (pub/sub) sur lequel un projet publie ses événements temps réel. */
export function projectChannel(projectId: string): string {
  return `project:${projectId}:events`;
}

const REQUIRED_FIELDS: Record<HifricaEventType, readonly string[]> = {
  "payment.pending": ["sessionId", "projectId", "simulator", "endpointId", "amount", "screen", "text", "createdAt"],
  "phone.confirm": ["sessionId", "projectId", "createdAt"],
  "phone.reject": ["sessionId", "projectId", "createdAt"],
  "sms.received": ["messageId", "projectId", "from", "to", "text", "createdAt"],
  "ussd.screen": ["sessionId", "projectId", "text", "end", "createdAt"],
  "ussd.input": ["sessionId", "projectId", "input", "createdAt"],
  "ussd.end": ["sessionId", "projectId", "reason", "createdAt"],
};

/** Vérifie à l'exécution qu'une valeur est un événement Hifrica valide (type + champs obligatoires). */
export function isHifricaEvent(value: unknown): value is HifricaEvent {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== "string" || !Object.hasOwn(REQUIRED_FIELDS, type)) return false;

  const required = REQUIRED_FIELDS[type as HifricaEventType];
  if (!required.every((field) => obj[field] !== undefined && obj[field] !== null)) return false;
  if (typeof obj.projectId !== "string" || typeof obj.createdAt !== "string") return false;
  if (obj.sessionId !== undefined && typeof obj.sessionId !== "string") return false;

  switch (type as HifricaEventType) {
    case "payment.pending":
      return (
        typeof obj.amount === "number" &&
        obj.screen === "confirm-payment" &&
        typeof obj.text === "string"
      );
    case "ussd.screen":
      return typeof obj.text === "string" && typeof obj.end === "boolean";
    case "ussd.end":
      return obj.reason === "completed" || obj.reason === "timeout" || obj.reason === "cancelled";
    default:
      return true;
  }
}
