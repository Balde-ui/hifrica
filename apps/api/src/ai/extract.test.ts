// Lecture tolérante des réponses des modèles (incident R3) et diagnostic de forme sans fuite.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateSimulatorYaml } from "@hifrica/shared";
import { parse } from "yaml";
import { describeShape, extractSimulatorYaml, type ExtractionForm } from "./extract.js";
import { loadExampleYaml } from "./prompt.js";

const VALID_YAML = loadExampleYaml() ?? "";
const SIM = parse(VALID_YAML) as Record<string, unknown>;

describe("extraction tolérante du YAML", () => {
  const accepted: [string, string, ExtractionForm][] = [
    ['{"yaml": "<texte>"} (format demandé)', JSON.stringify({ yaml: VALID_YAML }), "json_yaml_string"],
    ['{"yaml": {<objet>}}', JSON.stringify({ yaml: SIM }), "json_yaml_object"],
    ['{"simulator": "<texte>"} (une seule clé, texte)', JSON.stringify({ simulator: VALID_YAML }), "json_single_key_string"],
    ['{"content": {<objet>}} (une seule clé, objet)', JSON.stringify({ content: SIM }), "json_single_key_object"],
    ["JSON qui est le simulateur", JSON.stringify(SIM), "json_simulator"],
    ["JSON indenté qui est le simulateur", JSON.stringify(SIM, null, 2), "json_simulator"],
    ["```json … ``` autour de {\"yaml\": …}", "```json\n" + JSON.stringify({ yaml: VALID_YAML }) + "\n```", "json_yaml_string"],
    ["```json … ``` autour du simulateur", "```json\n" + JSON.stringify(SIM, null, 2) + "\n```", "json_simulator"],
    ["``` sans langage autour de {\"yaml\": {…}}", "```\n" + JSON.stringify({ yaml: SIM }) + "\n```", "json_yaml_object"],
    ["```yaml … ``` autour du YAML", "```yaml\n" + VALID_YAML + "```", "yaml_text"],
    ["YAML brut (pas du JSON)", VALID_YAML, "yaml_text"],
    ['{"yaml": "```yaml … ```"} (clôture dans la valeur)', JSON.stringify({ yaml: "```yaml\n" + VALID_YAML + "```" }), "json_yaml_string"],
    ['{"simulator": "```yaml … ```"}', JSON.stringify({ simulator: "```yaml\n" + VALID_YAML + "```" }), "json_single_key_string"],
  ];
  for (const [label, text, form] of accepted) {
    it(`${label} → YAML valide accepté (${form})`, () => {
      const result = extractSimulatorYaml(text);
      assert.ok(result.ok, label);
      assert.equal(result.form, form);
      const validation = validateSimulatorYaml(result.yaml);
      assert.ok(validation.valid, validation.errors.join("; "));
      assert.deepEqual(validation.simulator, SIM, "même simulateur que l'exemple");
    });
  }

  it("le résultat passe toujours par la validation : un objet incomplet est extrait mais refusé par le schéma", () => {
    const result = extractSimulatorYaml(JSON.stringify({ yaml: { name: "Pas Valide", kind: "http" } }));
    assert.ok(result.ok);
    assert.equal(validateSimulatorYaml(result.yaml).valid, false);
  });

  const rejected: [string, string][] = [
    ["texte libre", "Désolé, je ne peux pas générer ce simulateur."],
    ["vide", "   "],
    ['{"yaml": 12}', JSON.stringify({ yaml: 12 })],
    ['{"yaml": ""}', JSON.stringify({ yaml: "" })],
    ["une seule clé, texte qui n'est pas un simulateur", JSON.stringify({ result: "Voici une explication." })],
    ["une seule clé, objet sans name ni kind", JSON.stringify({ simulator: { endpoints: [] } })],
    ["plusieurs clés sans yaml", JSON.stringify({ a: "x", b: 2 })],
    ["tableau", JSON.stringify([SIM])],
    ["YAML sans kind", "name: incomplet\nversion: 1.0.0\n"],
    ["JSON tronqué", JSON.stringify({ yaml: VALID_YAML }).slice(0, 300)],
  ];
  for (const [label, text] of rejected) {
    it(`forme inconnue (${label}) → refusée`, () => {
      assert.equal(extractSimulatorYaml(text).ok, false);
    });
  }
});

describe("forme d'une réponse illisible (diagnostic sans fuite)", () => {
  const SECRETS = ["sk_test_SECRET0123456789", "awa@boutique.sn", "+221 77 123 45 67", "PIN 4321", "Voici"];

  it("JSON objet : clés et types de premier niveau, aucune valeur", () => {
    const text = JSON.stringify({
      message: `Voici ${SECRETS[0]} ${SECRETS[1]}`,
      count: 3,
      ok: true,
      nested: { contact: SECRETS[2] },
      list: [SECRETS[3]],
      nothing: null,
      "clé avec espace et accent é": "x",
      [SECRETS[1]]: "une clé qui est une donnée",
    });
    const shape = describeShape(text);
    assert.deepEqual(shape, {
      length: text.length,
      fenced: false,
      json: true,
      topType: "object",
      keys: ["message", "count", "ok", "nested", "list", "nothing", "?", "?"],
      valueTypes: ["string", "number", "boolean", "object", "array", "null", "string", "string"],
    });
    const serialized = JSON.stringify(shape);
    for (const s of SECRETS) assert.ok(!serialized.includes(s), `aucune donnée : ${s}`);
  });

  it("clôture ```json détectée, texte libre décrit comme « text »", () => {
    const fenced = describeShape("```json\n" + JSON.stringify({ reponse: "x", detail: "y" }) + "\n```");
    assert.equal(fenced.fenced, true);
    assert.equal(fenced.fenceLang, "json");
    assert.deepEqual(fenced.keys, ["reponse", "detail"]);
    const prose = describeShape(`Voici le simulateur demandé, contact ${SECRETS[1]}.`);
    assert.deepEqual(prose, { length: prose.length, fenced: false, json: false, topType: "text" });
    assert.ok(!JSON.stringify(prose).includes("Voici"));
  });

  it("au plus 20 clés décrites", () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    assert.equal(describeShape(JSON.stringify(many)).keys?.length, 20);
  });

  it("extractSimulatorYaml renvoie la forme quand la réponse reste illisible", () => {
    const result = extractSimulatorYaml(JSON.stringify({ reponse: `texte ${SECRETS[0]}`, n: 1 }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.shape.keys, ["reponse", "n"]);
      assert.ok(!JSON.stringify(result.shape).includes(SECRETS[0]));
    }
  });
});
