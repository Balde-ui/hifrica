// Lecture tolérante des réponses des modèles (incident R3) et diagnostic de forme sans fuite.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateSimulatorYaml } from "@hifrica/shared";
import { parse } from "yaml";
import { describeShape, escapeRawControlsInStrings, extractSimulatorYaml, jsonErrorCategory, unescapeJsonLoose, type ExtractionForm } from "./extract.js";
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
      firstChar: "{",
      hasYamlKey: false,
      hasRawNewlineInString: false,
      repaired: false,
      rescuedByYamlSlice: false,
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
    assert.deepEqual(prose, {
      length: prose.length,
      firstChar: "autre",
      hasYamlKey: false,
      hasRawNewlineInString: false,
      repaired: false,
      rescuedByYamlSlice: false,
      fenced: false,
      json: false,
      topType: "text",
    });
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

/** {"yaml": "<texte>"} tel que DeepSeek l'a renvoyé pendant R3 : guillemets échappés, mais VRAIS retours à la ligne. */
const rawJson = (yaml: string, before = '{"yaml": "', after = '"}') =>
  before + yaml.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + after;

describe("réparation : caractères de contrôle bruts dans les chaînes JSON (incident R3, suite)", () => {
  it("parcours : seuls les \\n, \\r, \\t DANS une chaîne sont échappés ; \\\" et \\\\ suivis correctement", () => {
    const text = '{\n\t"a": "l1\nl2\tx",\r\n "b": "q\\"\nr", "c": "\\\\", "d": "s\nt"\n}';
    const scan = escapeRawControlsInStrings(text);
    assert.equal(scan.rawNewlines, 3);
    assert.equal(scan.rawTabs, 1);
    assert.deepEqual(JSON.parse(scan.text), { a: "l1\nl2\tx", b: 'q"\nr', c: "\\", d: "s\nt" });
    assert.ok(scan.text.startsWith('{\n\t"a"'), "blancs hors chaîne inchangés");
    assert.deepEqual(escapeRawControlsInStrings('{"a": "ok"}'), { text: '{"a": "ok"}', rawNewlines: 0, rawTabs: 0 });
  });

  const accepted: [string, string, ExtractionForm, { repaired: boolean; prefixSkipped: boolean }][] = [
    ["retours à la ligne bruts dans la chaîne yaml", rawJson(VALID_YAML), "json_yaml_string", { repaired: true, prefixSkipped: false }],
    ["retours à la ligne CRLF bruts", rawJson(VALID_YAML.replace(/\n/g, "\r\n")), "json_yaml_string", { repaired: true, prefixSkipped: false }],
    [
      "tabulations brutes (dans la chaîne et hors chaîne) et retours à la ligne bruts",
      rawJson(VALID_YAML.replace("name: ", "name:\t").replace("version: ", "version:\t"), '{\n\t"yaml":\t"', '"\n}'),
      "json_yaml_string",
      { repaired: true, prefixSkipped: false },
    ],
    [
      "tabulations brutes seules (retours à la ligne bien échappés)",
      JSON.stringify({ yaml: VALID_YAML.replace("name: ", "name:\t") }).replace("\\t", "\t"),
      "json_yaml_string",
      { repaired: true, prefixSkipped: false },
    ],
    ["```json … ``` autour d'un JSON à retours bruts", "```json\n" + rawJson(VALID_YAML) + "\n```", "json_yaml_string", { repaired: true, prefixSkipped: false }],
    ["phrase avant le JSON", "Voici le simulateur demandé :\n" + JSON.stringify({ yaml: VALID_YAML }), "json_yaml_string", { repaired: false, prefixSkipped: true }],
    ["phrase sur la même ligne que le JSON", "Voici : " + JSON.stringify({ yaml: VALID_YAML }), "json_yaml_string", { repaired: false, prefixSkipped: true }],
    ["phrase avant un JSON à retours bruts", "Voici le simulateur :\n\n" + rawJson(VALID_YAML), "json_yaml_string", { repaired: true, prefixSkipped: true }],
    ["phrase avant ```json … ```", "Voici :\n```json\n" + JSON.stringify({ yaml: VALID_YAML }) + "\n```", "json_yaml_string", { repaired: false, prefixSkipped: true }],
    ["phrase avant « name: »", "Voici le YAML demandé :\n" + VALID_YAML, "yaml_text", { repaired: false, prefixSkipped: true }],
    ["phrase avant ```yaml … ```", "Voici le YAML :\n```yaml\n" + VALID_YAML + "```", "yaml_text", { repaired: false, prefixSkipped: true }],
  ];
  for (const [label, text, form, flags] of accepted) {
    it(`${label} → accepté (${form})`, () => {
      const result = extractSimulatorYaml(text);
      assert.ok(result.ok, label);
      assert.equal(result.form, form);
      assert.deepEqual({ repaired: result.repaired, prefixSkipped: result.prefixSkipped }, flags);
      const validation = validateSimulatorYaml(result.yaml);
      assert.ok(validation.valid, validation.errors.join("; "));
      assert.deepEqual(validation.simulator, SIM, "même simulateur que l'exemple");
    });
  }

  it("YAML qui ne commence pas par « name: » (commentaire, autre clé) : pris tel quel, rien n'est retiré", () => {
    const [first, second, ...rest] = VALID_YAML.split("\n");
    const text = ["# simulateur généré", second, first, ...rest].join("\n");
    const result = extractSimulatorYaml(text);
    assert.ok(result.ok);
    assert.deepEqual([result.form, result.prefixSkipped, result.yaml], ["yaml_text", false, text.trim()]);
  });

  it("forme standard : ni réparée ni préfixe ignoré", () => {
    const result = extractSimulatorYaml(JSON.stringify({ yaml: VALID_YAML }));
    assert.ok(result.ok);
    assert.deepEqual([result.repaired, result.prefixSkipped], [false, false]);
  });

  const SECRET = "sk_test_FUITE0123456789";
  const notEnough: [string, string][] = [
    ["JSON à retours bruts tronqué", rawJson(VALID_YAML).slice(0, 400)],
    // « guillemets non échappés » : désormais récupéré par l'étape de secours (voir plus bas).
    ["retours bruts mais objet sans simulateur", `{"reponse": "Voici\nla clé ${SECRET}\n"}`],
    ["phrase avant un texte qui n'est rien", "Voici ma réponse : { pas du json ni du yaml"],
  ];
  for (const [label, text] of notEnough) {
    it(`réparation insuffisante (${label}) → unreadable, avec la forme et sans contenu`, () => {
      const result = extractSimulatorYaml(text);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.shape.repaired, false);
      assert.equal(result.shape.json, false);
      const serialized = JSON.stringify(result.shape);
      for (const s of [SECRET, "paiement-mobile", "Voici", "checkout"]) assert.ok(!serialized.includes(s), `aucune donnée : ${s}`);
    });
  }

  it("forme d'un JSON à retours bruts : firstChar, hasYamlKey, hasRawNewlineInString", () => {
    const shape = describeShape(rawJson(VALID_YAML).slice(0, 400));
    assert.deepEqual(
      { firstChar: shape.firstChar, hasYamlKey: shape.hasYamlKey, hasRawNewlineInString: shape.hasRawNewlineInString, repaired: shape.repaired, json: shape.json, fenced: shape.fenced },
      { firstChar: "{", hasYamlKey: true, hasRawNewlineInString: true, repaired: false, json: false, fenced: false },
    );
    assert.equal(describeShape(rawJson(VALID_YAML), { repaired: true }).repaired, true);
    assert.equal(describeShape(JSON.stringify({ yaml: VALID_YAML })).hasRawNewlineInString, false, "\\n échappés : rien de brut");
    assert.equal(describeShape("Voici :\n" + rawJson(VALID_YAML)).hasRawNewlineInString, true, "parcours depuis le premier « { »");
  });

  it("firstChar : seulement {, [, n, ` ou « autre »", () => {
    assert.equal(describeShape("[1]").firstChar, "[");
    assert.equal(describeShape("name: x").firstChar, "n");
    assert.equal(describeShape("```json\n{}\n```").firstChar, "`");
    assert.equal(describeShape("  {}").firstChar, "{");
    for (const t of ["Voici", "kind: http", "1", "\"yaml\"", "ñ"]) assert.equal(describeShape(t).firstChar, "autre", t);
    const empty = extractSimulatorYaml("");
    assert.ok(!empty.ok && empty.shape.firstChar === "autre");
  });
});

describe("secours : valeur yaml découpée malgré des guillemets non échappés ou des échappements invalides (incident R3, suite)", () => {
  /** Variante de l'exemple avec une apostrophe (pour \') ; les " du YAML (body: { id: "{{uuid}}" … }) restent. */
  const QUOTED_YAML = VALID_YAML.replace("description: Paiement mobile", "description: L'appli de paiement mobile");
  const QUOTED_SIM = parse(QUOTED_YAML) as Record<string, unknown>;
  assert.notEqual(QUOTED_YAML, VALID_YAML);
  /** {"yaml": "…"} : \n échappés, mais guillemets intérieurs laissés bruts. */
  const unescapedQuotes = (yaml: string) => '{"yaml": "' + yaml.replace(/\n/g, "\\n") + '"}';

  it("désérialisation tolérante : \\n \\r \\t \\\" \\\\ \\/ \\uXXXX interprétés, \\x inconnu → x", () => {
    assert.equal(unescapeJsonLoose('a\\nb\\rc\\td\\"e\\\\f\\/g\\u00e9h'), 'a\nb\rc\td"e\\f/géh');
    assert.equal(unescapeJsonLoose("l\\'appli \\q \\u12zz"), "l'appli q u12zz");
    assert.equal(unescapeJsonLoose('brut "guillemets" et\nretour'), 'brut "guillemets" et\nretour', "rien de brut n'est touché");
    assert.equal(unescapeJsonLoose("fin\\"), "fin\\", "barre finale isolée conservée");
  });

  const accepted: [string, string, Record<string, unknown>, { repaired: boolean; prefixSkipped: boolean }][] = [
    ["guillemets intérieurs non échappés", unescapedQuotes(VALID_YAML), SIM, { repaired: false, prefixSkipped: false }],
    ["échappement invalide \\'", JSON.stringify({ yaml: QUOTED_YAML }).replace("L'appli", "L\\'appli"), QUOTED_SIM, { repaired: false, prefixSkipped: false }],
    [
      "guillemets non échappés + \\' + retours à la ligne bruts",
      '{"yaml": "' + QUOTED_YAML.replace("L'appli", "L\\'appli") + '"}',
      QUOTED_SIM,
      { repaired: false, prefixSkipped: false },
    ],
    ["blancs autour de la clé et avant la « } » finale", '{ \n "yaml" :  "' + VALID_YAML.replace(/\n/g, "\\n") + '" \n }', SIM, { repaired: false, prefixSkipped: false }],
    ["phrase avant + guillemets non échappés", "Voici le simulateur :\n" + unescapedQuotes(VALID_YAML), SIM, { repaired: false, prefixSkipped: true }],
    ["```json … ``` + guillemets non échappés", "```json\n" + unescapedQuotes(VALID_YAML) + "\n```", SIM, { repaired: false, prefixSkipped: false }],
  ];
  for (const [label, text, expected, flags] of accepted) {
    it(`${label} → accepté (json_yaml_string, rescuedByYamlSlice)`, () => {
      assert.throws(() => JSON.parse(text.replace(/^[^{]*/, "").replace(/[^}]*$/, "")), "le JSON est bien invalide");
      const result = extractSimulatorYaml(text);
      assert.ok(result.ok, label);
      assert.equal(result.form, "json_yaml_string");
      assert.equal(result.rescuedByYamlSlice, true);
      assert.deepEqual({ repaired: result.repaired, prefixSkipped: result.prefixSkipped }, flags);
      const validation = validateSimulatorYaml(result.yaml);
      assert.ok(validation.valid, validation.errors.join("; "));
      assert.deepEqual(validation.simulator, expected);
    });
  }

  it("JSON valide ou réparable : l'étape de secours ne sert pas", () => {
    for (const text of [JSON.stringify({ yaml: VALID_YAML }), rawJson(VALID_YAML)]) {
      const result = extractSimulatorYaml(text);
      assert.ok(result.ok);
      assert.equal(result.rescuedByYamlSlice, false);
    }
  });

  const notApplicable: [string, string][] = [
    ["deux clés (yaml puis note)", '{"yaml": "' + VALID_YAML.replace(/\n/g, "\\n") + '", "note": "voir "doc""}'],
    ["deux clés (note puis yaml)", '{"note": "x", "yaml": "' + VALID_YAML.replace(/\n/g, "\\n") + '"}'],
    ["clé ≠ yaml", '{"simulator": "' + VALID_YAML.replace(/\n/g, "\\n") + '"}'],
    ["clé « Yaml »", '{"Yaml": "' + VALID_YAML.replace(/\n/g, "\\n") + '"}'],
    ["valeur qui n'est pas une chaîne", '{"yaml": {"name": "x" "kind": "http"}}'],
    ["valeur vide", '{"yaml": " "x}'],
  ];
  for (const [label, text] of notApplicable) {
    it(`l'étape de secours ne s'applique pas (${label}) → refusé`, () => {
      const result = extractSimulatorYaml(text);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.shape.rescuedByYamlSlice, false);
    });
  }

  const SECRET = "sk_test_FUITE0123456789";
  it("JSON tronqué (guillemets non échappés, sans « \"} » final) → refusé, forme avec jsonError, sans contenu", () => {
    const text = unescapedQuotes(VALID_YAML.replace("Paiement mobile", `Paiement ${SECRET}`)).slice(0, 500);
    const result = extractSimulatorYaml(text);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.shape.rescuedByYamlSlice, false);
    assert.equal(result.shape.hasYamlKey, true);
    assert.equal(result.shape.jsonError, "unexpected_token");
    const serialized = JSON.stringify(result.shape);
    for (const s of [SECRET, "paiement-mobile", "checkout", "{{uuid}}", "position", "Expected"]) assert.ok(!serialized.includes(s), `aucune donnée : ${s}`);
  });

  it("jsonError : catégorie seulement, déduite du message de JSON.parse", () => {
    assert.equal(describeShape('{"yaml": "l\\\'appli"}').jsonError, "bad_escape");
    assert.equal(describeShape('{"yaml": "\\u12zz"}').jsonError, "bad_escape");
    assert.equal(describeShape('{"yaml": "un "mot" ici"}').jsonError, "unexpected_token");
    assert.equal(describeShape('{"yaml": "tronqué').jsonError, "unterminated_string");
    assert.equal(describeShape('{"yaml": "a\u0001b"}').jsonError, "other", "autre caractère de contrôle brut");
    assert.equal(describeShape('{"yaml": ').jsonError, "other", "Unexpected end of JSON input");
    assert.equal(describeShape('{"yaml": "ligne\nsuivante"}').jsonError, undefined, "contrôles bruts réparables : pas d'erreur restante");
    assert.equal(describeShape(JSON.stringify({ yaml: "ok" })).jsonError, undefined);
    assert.equal(describeShape("Voici du texte").jsonError, undefined, "aucun « { » : rien à décrire");
    assert.equal(jsonErrorCategory(new Error("Unexpected token 'x', \"secret\" is not valid JSON")), "unexpected_token");
    assert.equal(jsonErrorCategory("pas une erreur"), "other");
  });
});
