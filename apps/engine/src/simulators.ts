import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateSimulatorYaml } from "@hifrica/shared";

export interface PhoneBlock {
  screen?: "confirm-payment" | "sms" | "notification";
  text?: string;
}

export interface WebhookBlock {
  /** Déclencheur (ex. phone.confirm) ; absent = envoi différé après la réponse. */
  on?: string;
  after?: string;
  event: string;
  body?: unknown;
}

export interface Endpoint {
  id: string;
  method: string;
  path: string;
  response: { status: number; headers?: Record<string, string>; body?: unknown };
  phone?: PhoneBlock;
  webhook?: WebhookBlock;
}

export interface Scenario {
  endpoint: string;
  match?: Record<string, string>;
  response?: Endpoint["response"];
  delay?: string;
}

export interface UssdMenu {
  text: string;
  /** Branchement par valeur exacte saisie (menu à choix : "1" -> "solde"). */
  on?: Record<string, string>;
  /** Si présent, la saisie brute est stockée sous ce nom de variable (menu à saisie libre). */
  input?: string;
  /** Menu suivant par défaut : utilisé si `on` ne correspond pas, ou avec `input` pour un enchaînement linéaire. */
  next?: string;
  end?: boolean;
  /** Si true, la saisie de cette étape (ex. un PIN) n'est jamais journalisée ni stockée dans les variables. */
  sensitive?: boolean;
}

export interface Simulator {
  name: string;
  kind: "http" | "ussd";
  auth?: "bearer" | "api_key";
  endpoints?: Endpoint[];
  scenarios?: Record<string, Scenario>;
  code?: string;
  menus?: Record<string, UssdMenu>;
}

/** Charge et valide les simulateurs YAML d'un dossier. Un fichier invalide est ignoré et signalé. */
export function loadSimulators(dir: string, log: (msg: string) => void): Map<string, Simulator> {
  const sims = new Map<string, Simulator>();
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  } catch {
    log(`Dossier de simulateurs introuvable : ${dir}`);
    return sims;
  }
  for (const file of files) {
    const result = validateSimulatorYaml(readFileSync(join(dir, file), "utf8"));
    if (!result.valid) {
      log(`Simulateur ignoré (${file}) : ${result.errors.join(" ; ")}`);
      continue;
    }
    const sim = result.simulator as Simulator;
    sims.set(sim.name, sim);
    log(`Simulateur chargé : ${sim.name}`);
  }
  return sims;
}

/** Compare un chemin déclaré (/v1/checkout/{id}) à un chemin reçu ; renvoie les paramètres ou null. */
export function matchPath(pattern: string, actual: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const a = actual.split("/").filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i];
    if (seg.startsWith("{") && seg.endsWith("}")) params[seg.slice(1, -1)] = decodeURIComponent(a[i]);
    else if (seg !== a[i]) return null;
  }
  return params;
}

/** Vérifie une condition de scénario simple : "> 500000", "< 10", "!= x", "contains x" ou égalité. */
export function conditionHolds(expected: string, actual: unknown): boolean {
  const value = actual === undefined || actual === null ? "" : String(actual);
  const m = expected.trim().match(/^(>=|<=|>|<|!=|contains)\s+(.*)$/);
  if (!m) return value === expected.trim();
  const [, op, rhs] = m;
  const n = Number(value);
  const r = Number(rhs);
  switch (op) {
    case ">": return n > r;
    case "<": return n < r;
    case ">=": return n >= r;
    case "<=": return n <= r;
    case "!=": return value !== rhs;
    case "contains": return value.includes(rhs);
    default: return false;
  }
}
