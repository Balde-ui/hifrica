// JSON Schema du format YAML des simulateurs Hifrica.
// Source unique de vérité : utilisé par l'API, le moteur, l'éditeur et la sortie du LLM.

const response = {
  type: "object",
  required: ["status"],
  additionalProperties: false,
  properties: {
    status: { type: "integer", minimum: 100, maximum: 599 },
    headers: { type: "object", additionalProperties: { type: "string" } },
    body: {},
  },
} as const;

const webhook = {
  type: "object",
  required: ["event"],
  additionalProperties: false,
  properties: {
    on: { type: "string", description: "Déclencheur, ex. phone.confirm ; absent = envoi différé après la réponse" },
    after: { type: "string", pattern: "^[0-9]+(ms|s)$" },
    event: { type: "string" },
    body: {},
  },
} as const;

const endpoint = {
  type: "object",
  required: ["id", "method", "path", "response"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[a-z0-9-]+$" },
    method: { enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
    path: { type: "string", pattern: "^/" },
    response,
    phone: {
      type: "object",
      additionalProperties: false,
      properties: {
        screen: { enum: ["confirm-payment", "sms", "notification"] },
        text: { type: "string", maxLength: 500 },
      },
    },
    webhook,
  },
} as const;

const scenario = {
  type: "object",
  required: ["endpoint"],
  additionalProperties: false,
  properties: {
    endpoint: { type: "string" },
    match: { type: "object", additionalProperties: { type: "string" } },
    response,
    delay: { type: "string", pattern: "^[0-9]+(ms|s)$" },
    webhook_repeat: { type: "integer", minimum: 1, maximum: 5 },
  },
} as const;

const ussdMenu = {
  type: "object",
  required: ["text"],
  additionalProperties: false,
  properties: {
    text: { type: "string", maxLength: 182 },
    on: { type: "object", additionalProperties: { type: "string" } },
    input: { type: "string" },
    next: { type: "string" },
    end: { type: "boolean" },
    // Si true, la saisie de cette étape (ex. un code PIN) n'est jamais journalisée en clair :
    // le moteur (B3) et le journal (C4) doivent la masquer avant toute écriture.
    sensitive: { type: "boolean" },
  },
} as const;

export const simulatorSchema = {
  $id: "https://hifrica/simulator.schema.json",
  type: "object",
  required: ["name", "version", "kind"],
  additionalProperties: false,
  properties: {
    name: { type: "string", pattern: "^[a-z0-9-]{3,60}$" },
    version: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
    description: { type: "string", maxLength: 1000 },
    kind: { enum: ["http", "ussd"] },
    auth: { enum: ["bearer", "api_key"] },
    endpoints: { type: "array", minItems: 1, maxItems: 30, items: endpoint },
    code: { type: "string", pattern: "^\\*[0-9*]+#$" },
    menus: { type: "object", required: ["start"], additionalProperties: ussdMenu },
    scenarios: { type: "object", additionalProperties: scenario },
  },
  allOf: [
    { if: { properties: { kind: { const: "http" } } }, then: { required: ["auth", "endpoints"] } },
    { if: { properties: { kind: { const: "ussd" } } }, then: { required: ["code", "menus"] } },
  ],
} as const;
