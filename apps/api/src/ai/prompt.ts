// Propriétaire : Dev A
// Construction des prompts de l'assistant IA (système, demande initiale, demande de correction).
import { readFileSync } from "node:fs";
import { simulatorSchema } from "@hifrica/shared";

export type SimulatorKind = "http" | "ussd";

/** Exemple de référence, à la racine du dépôt (copié dans l'image Docker de l'API). */
const EXAMPLE_URL = new URL("../../../../simulators/paiement-mobile-generique.yaml", import.meta.url);

/** Lit l'exemple de simulateur ; undefined s'il est introuvable (le prompt reste utilisable sans lui). */
export function loadExampleYaml(url: URL = EXAMPLE_URL): string | undefined {
  try {
    return readFileSync(url, "utf8");
  } catch {
    return undefined;
  }
}

/** Prompt système : rôle, JSON Schema complet, exemple, règles, format de sortie json. */
export function buildSystemPrompt(exampleYaml?: string): string {
  const parts = [
    "Tu génères un simulateur Hifrica : un fichier YAML qui décrit une API de test (paiement mobile, SMS, USSD...) " +
      "utilisée par des développeurs pour tester leur intégration sans argent réel.",
    "",
    "## Format YAML attendu (JSON Schema complet, à respecter strictement)",
    JSON.stringify(simulatorSchema),
    "",
  ];
  if (exampleYaml) {
    parts.push("## Exemple de simulateur valide", "```yaml", exampleYaml.trim(), "```", "");
  }
  parts.push(
    "## Règles",
    "- `name` en kebab-case : minuscules, chiffres et tirets uniquement, 3 à 60 caractères. `version` au format 1.0.0.",
    "- `kind: http` exige `auth` et `endpoints` ; `kind: ussd` exige `code` (ex. *123#) et `menus` avec un menu `start`.",
    "- Prévois au moins un scénario d'échec réaliste dans `scenarios` (solde insuffisant, marchand suspendu, délai dépassé...).",
    "- Montants en XOF (francs CFA) par défaut, sauf si la description précise une autre devise.",
    "- Textes USSD de 182 caractères au maximum.",
    "- Gabarits disponibles dans les réponses : {{uuid}}, {{now}}, {{body.champ}}, {{query.champ}}, {{params.champ}}.",
    "- Jamais de vraies URL, de vraies marques, de vrais noms, numéros, emails ou clés : uniquement des données fictives.",
    "- La description a été masquée : [EMAIL], [TEL], [CLE], [IBAN], [CARTE] remplacent des données réelles ; " +
      "ne les recopie pas, utilise des valeurs fictives.",
    "- N'ajoute aucun champ absent du schéma.",
    "",
    "## Format de sortie",
    'Réponds uniquement avec un objet json de la forme {"yaml": "<le YAML complet>"}, sans texte autour ni bloc de code. ' +
      "Le YAML est une chaîne json (retours à la ligne échappés en \\n).",
  );
  return parts.join("\n");
}

/** Demande initiale, à partir de la description déjà masquée. */
export function buildUserPrompt(maskedDescription: string, kind?: SimulatorKind): string {
  const lines = ["Description du simulateur à générer :", maskedDescription.trim()];
  if (kind) lines.push("", `Type de simulateur imposé : kind: ${kind}.`);
  lines.push("", 'Réponds en json : {"yaml": "..."}.');
  return lines.join("\n");
}

/** Demande de correction : erreurs de validation et YAML fautif. */
export function buildCorrectionPrompt(yaml: string, errors: string[]): string {
  return [
    "Le YAML que tu as produit est invalide. Erreurs de validation :",
    ...errors.map((e) => `- ${e}`),
    "",
    "YAML fautif :",
    "```yaml",
    yaml.trim(),
    "```",
    "",
    'Corrige toutes les erreurs et renvoie le simulateur complet en json : {"yaml": "..."}.',
  ].join("\n");
}
