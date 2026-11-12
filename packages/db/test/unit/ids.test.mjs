import { test } from "node:test";
import assert from "node:assert/strict";
import { parseApiId, toApiId } from "../../dist/index.js";

test("au-delà de 2^53, l'identifiant est conservé exactement (pas de conversion en Number)", () => {
  const beyond = "9007199254740993"; // 2^53 + 1 : Number l'arrondirait à ...992
  assert.equal(Number(beyond).toString() === beyond, false);
  assert.equal(toApiId(parseApiId(beyond)), beyond);
  assert.equal(toApiId(parseApiId("9223372036854775807")), "9223372036854775807");
});

test("identifiants invalides : null (à traduire en 400)", () => {
  for (const bad of ["0", "-1", "01", "abc", "1.5", " 1", "", "9223372036854775808", "1".repeat(20), 12, null, undefined]) {
    assert.equal(parseApiId(bad), null, String(bad));
  }
});
