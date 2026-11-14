// Propriétaire : Dev A
// Lecture tolérante de la réponse d'un modèle (incident R3 : réponse DeepSeek présente mais rejetée).
// On cherche le texte YAML du simulateur, dans cet ordre :
//   1. JSON {"yaml": "<texte>"} (format demandé dans le prompt) ;
//   2. JSON {"yaml": {<objet>}} → converti en texte YAML ;
//   3. JSON sans clé "yaml" : une seule clé dont la valeur est un simulateur (texte ou objet), ou un JSON qui
//      EST le simulateur (il a "name" et "kind") ;
//   4. contenu entouré de ```json / ```yaml → clôtures retirées, puis on recommence ;
//   5. texte qui n'est pas du JSON mais un YAML avec "name" et "kind".
// Rien n'est accepté ici sans validation : l'appelant passe toujours le résultat à validateSimulatorYaml.
// Si rien ne convient, seule la FORME de la réponse est décrite (types, noms de clés), jamais son contenu.
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** Comment le YAML a été trouvé (journalisé : aucune donnée). */
export type ExtractionForm =
  | "json_yaml_string"
  | "json_yaml_object"
  | "json_single_key_string"
  | "json_single_key_object"
  | "json_simulator"
  | "yaml_text";

export type ValueType = "string" | "number" | "boolean" | "null" | "array" | "object";

/** Forme d'une réponse illisible : de quoi diagnostiquer, sans aucune valeur reçue. */
export interface ResponseShape {
  length: number;
  /** Clôture ``` en tête de réponse, et son langage normalisé. */
  fenced: boolean;
  fenceLang?: "json" | "yaml" | "other" | "none";
  /** Le contenu (après retrait éventuel des clôtures) se lit en JSON. */
  json: boolean;
  /** Type de la valeur de premier niveau (JSON, sinon YAML), "text" si ni l'un ni l'autre ne donne de structure. */
  topType: ValueType | "text";
  /** Clés de premier niveau d'un objet (noms non conformes remplacés par "?"), 20 au plus. */
  keys?: string[];
  /** Type de chaque valeur de premier niveau, dans l'ordre de `keys`. */
  valueTypes?: ValueType[];
}

export type Extraction = { ok: true; yaml: string; form: ExtractionForm } | { ok: false; shape: ResponseShape };

const FENCE = /^```([A-Za-z0-9_-]*)[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*```\s*$/;
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;
const MAX_KEYS = 20;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function typeOf(value: unknown): ValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean" ? t : "object";
}

/** Un objet de simulateur a au moins "name" et "kind" (le schéma vérifie le reste ensuite). */
function isSimulatorObject(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && typeof value.name === "string" && typeof value.kind === "string";
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function tryParseYaml(text: string): unknown {
  try {
    return parseYaml(text);
  } catch {
    return undefined;
  }
}

/** Texte YAML d'un objet, sans repli des longues lignes (le texte reste lisible tel quel). */
function toYaml(value: Record<string, unknown>): string {
  return stringifyYaml(value, { lineWidth: 0 });
}

/** Retire une clôture ``` éventuelle (dans une valeur "yaml" aussi : certains modèles l'y mettent). */
function unfence(text: string): string {
  const m = FENCE.exec(text.trim());
  return m ? m[2] : text;
}

/** Un texte qui, lu en YAML (le JSON en est un cas particulier), donne un simulateur. */
function simulatorText(text: string): string | null {
  const inner = unfence(text);
  return inner.trim() !== "" && isSimulatorObject(tryParseYaml(inner)) ? inner : null;
}

function fromJson(data: unknown): { yaml: string; form: ExtractionForm } | null {
  if (!isPlainObject(data)) return null;
  if ("yaml" in data) {
    const value = data.yaml;
    if (typeof value === "string" && value.trim() !== "") return { yaml: unfence(value), form: "json_yaml_string" };
    if (isPlainObject(value)) return { yaml: toYaml(value), form: "json_yaml_object" };
    return null;
  }
  if (isSimulatorObject(data)) return { yaml: toYaml(data), form: "json_simulator" };
  const keys = Object.keys(data);
  if (keys.length === 1) {
    const value = data[keys[0]];
    if (typeof value === "string") {
      const text = simulatorText(value);
      if (text !== null) return { yaml: text, form: "json_single_key_string" };
    }
    if (isSimulatorObject(value)) return { yaml: toYaml(value), form: "json_single_key_object" };
  }
  return null;
}

function attempt(text: string, allowUnfence: boolean): { yaml: string; form: ExtractionForm } | null {
  const json = tryParseJson(text);
  if (json.ok) return fromJson(json.value);
  if (allowUnfence) {
    const m = FENCE.exec(text);
    if (m) return attempt(m[2].trim(), false);
  }
  const data = tryParseYaml(text);
  return isSimulatorObject(data) ? { yaml: text, form: "yaml_text" } : null;
}

/** Forme de la réponse : types et noms de clés seulement, jamais une valeur. */
export function describeShape(text: string): ResponseShape {
  const trimmed = text.trim();
  const fence = FENCE.exec(trimmed);
  const lang = fence?.[1].toLowerCase();
  const inner = fence ? fence[2].trim() : trimmed;
  const json = tryParseJson(inner);
  const value = json.ok ? json.value : tryParseYaml(inner);
  const structured = json.ok || isPlainObject(value) || Array.isArray(value);
  const shape: ResponseShape = {
    length: text.length,
    fenced: Boolean(fence),
    ...(fence ? { fenceLang: lang === "json" ? "json" : lang === "yaml" || lang === "yml" ? "yaml" : lang ? "other" : "none" } : {}),
    json: json.ok,
    topType: structured ? typeOf(value) : "text",
  };
  if (structured && isPlainObject(value)) {
    const keys = Object.keys(value).slice(0, MAX_KEYS);
    shape.keys = keys.map((k) => (SAFE_KEY.test(k) ? k : "?"));
    shape.valueTypes = keys.map((k) => typeOf(value[k]));
  }
  return shape;
}

export function extractSimulatorYaml(text: string | undefined | null): Extraction {
  if (typeof text !== "string" || text.trim() === "") {
    return { ok: false, shape: { length: typeof text === "string" ? text.length : 0, fenced: false, json: false, topType: "text" } };
  }
  const found = attempt(text.trim(), true);
  return found ? { ok: true, ...found } : { ok: false, shape: describeShape(text) };
}
