// Validation du YAML dans le navigateur avec le MÊME code que l'API et le moteur
// (validateSimulatorYaml de @hifrica/shared), et position de chaque erreur dans le texte.
import { LineCounter, isNode, parseDocument } from "yaml";
import { MAX_YAML_BYTES, validateSimulatorYaml } from "@hifrica/shared";

export interface Problem {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
}

const MESSAGES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/must have required property '(.+)'/, (m) => `champ obligatoire manquant : ${m[1]}`],
  [/must NOT have additional properties/, () => "champ inconnu (absent du schéma)"],
  [/must be equal to one of the allowed values/, () => "valeur non autorisée"],
  [/must match pattern "(.+)"/, (m) => `format invalide (motif ${m[1]})`],
  [/must be (string|integer|number|boolean|object|array)/, (m) => `doit être de type ${m[1]}`],
  [/must NOT have more than (\d+) characters/, (m) => `${m[1]} caractères au plus`],
  [/must NOT have fewer than (\d+) characters/, (m) => `${m[1]} caractères au moins`],
  [/must be <= (\d+)/, (m) => `doit être ≤ ${m[1]}`],
  [/must be >= (\d+)/, (m) => `doit être ≥ ${m[1]}`],
];

function frenchMessage(message: string): string {
  for (const [re, fn] of MESSAGES) {
    const m = message.match(re);
    if (m) return fn(m);
  }
  return message;
}

export function findProblems(source: string): { valid: boolean; problems: Problem[]; simulator?: unknown } {
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { lineCounter });
  const pos = (offset: number) => lineCounter.linePos(Math.max(0, Math.min(offset, source.length)));

  // 1. Erreurs de syntaxe YAML, avec leur position exacte.
  if (doc.errors.length > 0) {
    return {
      valid: false,
      problems: doc.errors.map((e) => {
        const start = pos(e.pos[0]);
        const end = pos(e.pos[1]);
        return { line: start.line, column: start.col, endLine: end.line, endColumn: Math.max(end.col, start.col + 1), message: e.message.split("\n")[0] };
      }),
    };
  }

  // 2. Validation par le schéma partagé (même résultat que l'API et le moteur).
  if (new TextEncoder().encode(source).length > MAX_YAML_BYTES) {
    return { valid: false, problems: [{ line: 1, column: 1, endLine: 1, endColumn: 2, message: "Le fichier dépasse 64 Ko." }] };
  }
  const result = validateSimulatorYaml(source);
  if (result.valid) return { valid: true, problems: [], simulator: result.simulator };

  const problems = result.errors.map((raw) => {
    // Format de validateSimulatorYaml : "<instancePath> <message>" (instancePath JSON Pointer, "/" pour la racine).
    const space = raw.indexOf(" ");
    const pointer = space > 0 ? raw.slice(0, space) : "/";
    const message = frenchMessage(space > 0 ? raw.slice(space + 1) : raw);
    const segments = pointer
      .split("/")
      .slice(1)
      .filter((s) => s !== "")
      .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
      .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
    // On remonte jusqu'au nœud existant le plus proche (un champ manquant n'a pas de position).
    let node: unknown = null;
    for (let n = segments.length; n >= 0 && !node; n--) {
      const found = n === 0 ? doc.contents : doc.getIn(segments.slice(0, n), true);
      if (isNode(found) && found.range) node = found;
    }
    const range = (node as { range?: [number, number, number] } | null)?.range ?? [0, 1, 1];
    const start = pos(range[0]);
    // Un nœud de collection couvre plusieurs lignes : on souligne seulement sa première ligne.
    const end = pos(range[1]);
    const sameLine = end.line === start.line;
    return {
      line: start.line,
      column: start.col,
      endLine: start.line,
      endColumn: sameLine ? Math.max(end.col, start.col + 1) : 1000,
      message: pointer === "/" ? message : `${pointer} : ${message}`,
    };
  });
  return { valid: false, problems };
}
