// Propriétaire : Dev A
// Lecture tolérante de la réponse d'un modèle (incident R3 : réponse DeepSeek présente mais rejetée).
// On cherche le texte YAML du simulateur, dans cet ordre :
//   1. JSON {"yaml": "<texte>"} (format demandé dans le prompt) ;
//   2. JSON {"yaml": {<objet>}} → converti en texte YAML ;
//   3. JSON sans clé "yaml" : une seule clé dont la valeur est un simulateur (texte ou objet), ou un JSON qui
//      EST le simulateur (il a "name" et "kind") ;
//   4. contenu entouré de ```json / ```yaml → clôtures retirées, puis on recommence ;
//   5. texte qui n'est pas du JSON mais un YAML avec "name" et "kind".
// Réparations minimales (incident R3, suite : DeepSeek en mode JSON renvoie {"yaml": "…"} avec de VRAIS
// retours à la ligne dans la chaîne, donc un JSON invalide) :
//   - JSON invalide commençant par « { » : les \n, \r et \t bruts À L'INTÉRIEUR des chaînes sont échappés
//     (parcours caractère par caractère : dans une chaîne / hors chaîne, échappements), puis on réessaie ;
//   - phrase avant le premier « { » ou avant une ligne « name: » : ce qui précède est ignoré ;
//   - en dernier recours (suite R3 : guillemets " non échappés dans la valeur, échappements invalides comme \'),
//     pour un texte exactement de la forme {"yaml": "<VALEUR>"} : la VALEUR brute est prise entre le guillemet
//     ouvrant et le DERNIER guillemet suivi seulement de blancs puis de « } », et désérialisée avec tolérance.
// Rien n'est accepté ici sans validation : l'appelant passe toujours le résultat à validateSimulatorYaml.
// Si rien ne convient, seule la FORME de la réponse est décrite (types, noms de clés), jamais son contenu.
import { simulatorSchema } from "@hifrica/shared";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** Comment le YAML a été trouvé (journalisé : aucune donnée). */
export type ExtractionForm =
  | "json_yaml_string"
  | "json_yaml_object"
  | "json_single_key_string"
  | "json_single_key_object"
  | "json_simulator"
  | "yaml_text";

export type JsonErrorCategory = "bad_escape" | "unexpected_token" | "unterminated_string" | "other";

export type ValueType = "string" | "number" | "boolean" | "null" | "array" | "object";

/** Forme d'une réponse illisible : de quoi diagnostiquer, sans aucune valeur reçue. */
export interface ResponseShape {
  length: number;
  /** Premier caractère non blanc, réduit à une catégorie (jamais le caractère lui-même s'il est autre). */
  firstChar: "{" | "[" | "n" | "`" | "autre";
  /** Le texte contient `"yaml"`. */
  hasYamlKey: boolean;
  /** Retour à la ligne brut dans une chaîne JSON (parcours depuis le premier « { »). */
  hasRawNewlineInString: boolean;
  /** La réparation des caractères de contrôle a servi à lire la réponse. */
  repaired: boolean;
  /** La valeur "yaml" a été récupérée par découpe (étape de secours). */
  rescuedByYamlSlice: boolean;
  /**
   * Erreur de JSON.parse sur le JSON candidat (depuis le premier « { », après échappement des contrôles bruts),
   * en catégorie seulement : le message (qui cite un extrait du texte) n'est jamais recopié.
   */
  jsonError?: JsonErrorCategory;
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

interface Found {
  yaml: string;
  form: ExtractionForm;
  /** Caractères de contrôle bruts échappés dans les chaînes JSON. */
  repaired: boolean;
  /** Une phrase avant le JSON ou le YAML a été ignorée. */
  prefixSkipped: boolean;
  /** La valeur "yaml" a été récupérée par découpe (guillemets non échappés, échappements invalides). */
  rescuedByYamlSlice: boolean;
}

export type Extraction = ({ ok: true } & Found) | { ok: false; shape: ResponseShape };

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

const SCHEMA_KEYS: ReadonlySet<string> = new Set(Object.keys(simulatorSchema.properties));

/** Toutes les clés de premier niveau appartiennent au schéma (une phrase d'intro lue comme clé YAML n'y est pas). */
function hasOnlySchemaKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((k) => SCHEMA_KEYS.has(k));
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

interface ControlScan {
  /** Texte où les \n, \r, \t bruts des chaînes sont échappés. */
  text: string;
  rawNewlines: number;
  rawTabs: number;
}

/**
 * Échappe les caractères de contrôle \n, \r, \t qui se trouvent À L'INTÉRIEUR des chaînes JSON. Hors chaîne,
 * ils restent tels quels (blancs JSON valides). Un « \ » échappe le caractère suivant (\" ne ferme pas la chaîne).
 */
export function escapeRawControlsInStrings(text: string): ControlScan {
  const out: string[] = [];
  let inString = false;
  let escaped = false;
  let rawNewlines = 0;
  let rawTabs = 0;
  for (const ch of text) {
    if (!inString) {
      if (ch === '"') inString = true;
      out.push(ch);
    } else if (escaped) {
      escaped = false;
      out.push(ch);
    } else if (ch === "\\") {
      escaped = true;
      out.push(ch);
    } else if (ch === '"') {
      inString = false;
      out.push(ch);
    } else if (ch === "\n" || ch === "\r") {
      rawNewlines++;
      out.push(ch === "\n" ? "\\n" : "\\r");
    } else if (ch === "\t") {
      rawTabs++;
      out.push("\\t");
    } else {
      out.push(ch);
    }
  }
  return { text: out.join(""), rawNewlines, rawTabs };
}

/** JSON.parse, puis, pour un texte commençant par « { », un second essai après échappement des contrôles bruts. */
function parseJsonLoose(text: string): { ok: true; value: unknown; repaired: boolean } | { ok: false } {
  const direct = tryParseJson(text);
  if (direct.ok) return { ...direct, repaired: false };
  if (!text.startsWith("{")) return { ok: false };
  const scan = escapeRawControlsInStrings(text);
  if (scan.rawNewlines + scan.rawTabs === 0) return { ok: false };
  const again = tryParseJson(scan.text);
  return again.ok ? { ...again, repaired: true } : { ok: false };
}

/** Catégorie d'une erreur de JSON.parse, déduite de son message (jamais recopié : il cite le texte). */
export function jsonErrorCategory(err: unknown): JsonErrorCategory {
  const message = err instanceof Error ? err.message : "";
  if (/^Bad (escaped character|Unicode escape)/.test(message)) return "bad_escape";
  if (/^Unterminated string/.test(message)) return "unterminated_string";
  if (/^(Unexpected token|Unexpected non-whitespace|Expected )/.test(message)) return "unexpected_token";
  return "other";
}

/** Erreur du JSON candidat (après échappement des contrôles bruts), ou undefined s'il se lit. */
function jsonErrorOf(candidate: string): JsonErrorCategory | undefined {
  const scan = escapeRawControlsInStrings(candidate);
  try {
    JSON.parse(scan.text);
    return undefined;
  } catch (err) {
    return jsonErrorCategory(err);
  }
}

/** {"yaml": "<VALEUR>"} : un seul objet, une seule clé exactement "yaml" ; VALEUR jusqu'au DERNIER " avant la « } » finale. */
const YAML_SLICE = /^\{\s*"yaml"\s*:\s*"([\s\S]*)"\s*\}$/;
/** Dans la valeur découpée, ce qui ressemble à une clé JSON suivante (« ", "note": ») : il y avait plusieurs clés. */
const NEXT_JSON_KEY = /"\s*,\s*"[^"\n]*"\s*:/;

/**
 * Désérialisation tolérante d'une chaîne JSON : \n \r \t \" \\ \/ et \uXXXX interprétés ; toute autre
 * séquence \x (ex. \') donne x seul. Les guillemets non échappés et les caractères bruts restent tels quels.
 */
export function unescapeJsonLoose(raw: string): string {
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\" || i === raw.length - 1) {
      out.push(ch);
      continue;
    }
    const next = raw[++i];
    if (next === "n") out.push("\n");
    else if (next === "r") out.push("\r");
    else if (next === "t") out.push("\t");
    else if (next === "u" && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 1, i + 5))) {
      out.push(String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16)));
      i += 4;
    } else out.push(next); // \" \\ \/ et toute séquence inconnue : le caractère seul
  }
  return out.join("");
}

/** Étape de secours : la valeur de {"yaml": "<VALEUR>"} malgré un JSON invalide ; null si la forme ne convient pas. */
function sliceYamlValue(text: string): string | null {
  const m = YAML_SLICE.exec(text);
  if (!m || NEXT_JSON_KEY.test(m[1])) return null;
  const value = unescapeJsonLoose(m[1]);
  return value.trim() === "" ? null : unfence(value);
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

type Read = Pick<Found, "yaml" | "form">;

function fromJson(data: unknown): Read | null {
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

const NAME_LINE = /^name[ \t]*:/m;
const TRAILING_FENCE = /\r?\n?[ \t]*```\s*$/;

/**
 * Texte qui suit une phrase d'introduction : à partir du premier « { » (jusqu'au dernier « } ») ou de la
 * première ligne « name: », selon ce qui vient en premier. null s'il n'y a rien avant (ou rien à trouver).
 */
function afterPreamble(text: string): string | null {
  const brace = text.indexOf("{");
  const name = NAME_LINE.exec(text)?.index ?? -1;
  const starts = [brace, name].filter((i) => i > 0);
  if (starts.length === 0 || brace === 0 || name === 0) return null;
  const start = Math.min(...starts);
  if (start === brace) {
    const end = text.lastIndexOf("}");
    return text.slice(start, end > start ? end + 1 : undefined);
  }
  return text.slice(start).replace(TRAILING_FENCE, "");
}

function attempt(text: string, allowUnfence: boolean, allowPreamble: boolean): Found | null {
  const json = parseJsonLoose(text);
  if (json.ok) {
    const read = fromJson(json.value);
    return read ? { ...read, repaired: json.repaired, prefixSkipped: false, rescuedByYamlSlice: false } : null;
  }
  // Après les réparations : JSON toujours invalide, mais de la forme {"yaml": "<VALEUR>"}.
  const sliced = sliceYamlValue(text);
  if (sliced !== null) return { yaml: sliced, form: "json_yaml_string", repaired: false, prefixSkipped: false, rescuedByYamlSlice: true };
  if (allowUnfence) {
    const m = FENCE.exec(text);
    if (m) return attempt(m[2].trim(), false, false);
  }
  const data = tryParseYaml(text);
  const asYaml: Found | null = isSimulatorObject(data) ? { yaml: text, form: "yaml_text", repaired: false, prefixSkipped: false, rescuedByYamlSlice: false } : null;
  // « Voici le YAML :\nname: … » se lit aussi en YAML, avec la phrase comme clé en plus : on essaie alors sans
  // la phrase. Un YAML dont toutes les clés sont dans le schéma est pris tel quel (rien n'est retiré).
  if (asYaml && hasOnlySchemaKeys(data as Record<string, unknown>)) return asYaml;
  if (allowPreamble) {
    const rest = afterPreamble(text);
    const found = rest === null ? null : attempt(rest.trim(), true, false);
    if (found) return { ...found, prefixSkipped: true };
  }
  return asYaml;
}

function firstCharOf(trimmed: string): ResponseShape["firstChar"] {
  const c = trimmed.charAt(0);
  return c === "{" || c === "[" || c === "n" || c === "`" ? c : "autre";
}

/** Forme de la réponse : types et noms de clés seulement, jamais une valeur. */
export function describeShape(text: string, options: { repaired?: boolean; rescuedByYamlSlice?: boolean } = {}): ResponseShape {
  const trimmed = text.trim();
  const fence = FENCE.exec(trimmed);
  const lang = fence?.[1].toLowerCase();
  const inner = fence ? fence[2].trim() : trimmed;
  const json = tryParseJson(inner);
  const value = json.ok ? json.value : tryParseYaml(inner);
  const structured = json.ok || isPlainObject(value) || Array.isArray(value);
  const brace = inner.indexOf("{");
  const shape: ResponseShape = {
    length: text.length,
    firstChar: firstCharOf(trimmed),
    hasYamlKey: text.includes('"yaml"'),
    hasRawNewlineInString: brace >= 0 && escapeRawControlsInStrings(inner.slice(brace)).rawNewlines > 0,
    repaired: options.repaired ?? false,
    rescuedByYamlSlice: options.rescuedByYamlSlice ?? false,
    fenced: Boolean(fence),
    ...(fence ? { fenceLang: lang === "json" ? "json" : lang === "yaml" || lang === "yml" ? "yaml" : lang ? "other" : "none" } : {}),
    json: json.ok,
    topType: structured ? typeOf(value) : "text",
  };
  if (!json.ok && brace >= 0) {
    const end = inner.lastIndexOf("}");
    const jsonError = jsonErrorOf(inner.slice(brace, end > brace ? end + 1 : undefined));
    if (jsonError) shape.jsonError = jsonError;
  }
  if (structured && isPlainObject(value)) {
    const keys = Object.keys(value).slice(0, MAX_KEYS);
    shape.keys = keys.map((k) => (SAFE_KEY.test(k) ? k : "?"));
    shape.valueTypes = keys.map((k) => typeOf(value[k]));
  }
  return shape;
}

export function extractSimulatorYaml(text: string | undefined | null): Extraction {
  if (typeof text !== "string" || text.trim() === "") {
    const length = typeof text === "string" ? text.length : 0;
    return {
      ok: false,
      shape: {
        length,
        firstChar: "autre",
        hasYamlKey: false,
        hasRawNewlineInString: false,
        repaired: false,
        rescuedByYamlSlice: false,
        fenced: false,
        json: false,
        topType: "text",
      },
    };
  }
  const found = attempt(text.trim(), true, true);
  return found ? { ok: true, ...found } : { ok: false, shape: describeShape(text) };
}
