// E1 / M1 — validation des entrées (conception C4, §2.2). Les mêmes motifs sont confrontés aux
// CHECK de la base dans test/pg/validate.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import {
  InvalidInputError,
  assertErrorCode,
  assertHttpMethod,
  assertSlug,
  assertUuid,
  isErrorCode,
  isHttpMethod,
  isSlug,
  isUuid,
} from "../../dist/index.js";

const NON_STRINGS = [undefined, null, 42, 0, true, {}, [], ["a"], Symbol("s"), () => "x", 10n, new String("POST")];

/** L'erreur nomme le champ et la règle, jamais la valeur (ni dans le message, ni en JSON, ni via inspect). */
function assertRejectsWithout(fn, secret, field, rule) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof InvalidInputError);
    assert.equal(err.field, field);
    assert.equal(err.rule, rule);
    if (typeof secret === "string" && secret.length > 0) {
      for (const text of [err.message, err.stack ?? "", JSON.stringify(err), inspect(err, { showHidden: true }), String(err)]) {
        assert.ok(!text.includes(secret), "valeur rejetée présente dans l'erreur");
      }
    }
    return true;
  });
}

describe("isUuid / assertUuid", () => {
  const valid = ["123e4567-e89b-12d3-a456-426614174000", "123E4567-E89B-12D3-A456-426614174000", "00000000-0000-0000-0000-000000000000"];
  const invalid = [
    "",
    " 123e4567-e89b-12d3-a456-426614174000",
    "123e4567-e89b-12d3-a456-426614174000 ",
    "123e4567-e89b-12d3-a456-426614174000\n",
    "{123e4567-e89b-12d3-a456-426614174000}",
    "123e4567e89b12d3a456426614174000",
    "123e4567-e89b-12d3-a456-42661417400",
    "123e4567-e89b-12d3-a456-4266141740000",
    "g23e4567-e89b-12d3-a456-426614174000",
    "sk_test_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
  ];
  test("formes canoniques acceptées, casse comprise, valeur renvoyée inchangée", () => {
    for (const v of valid) {
      assert.equal(isUuid(v), true, v);
      assert.equal(assertUuid(v, "projectId"), v);
    }
  });
  test("espaces, accolades, longueur, caractères : refusés sans la valeur", () => {
    for (const v of invalid) {
      assert.equal(isUuid(v), false, JSON.stringify(v));
      assertRejectsWithout(() => assertUuid(v, "projectId"), v, "projectId", "must_be_uuid");
    }
  });
  test("types non textuels : required (absent) ou must_be_string, sans conversion", () => {
    for (const v of NON_STRINGS) {
      assert.equal(isUuid(v), false);
      assertRejectsWithout(() => assertUuid(v, "projectId"), undefined, "projectId", v == null ? "required" : "must_be_string");
    }
  });
});

describe("isHttpMethod / assertHttpMethod", () => {
  test("jetons RFC 9110 de 1 à 10 caractères acceptés tels quels (casse conservée)", () => {
    for (const v of ["GET", "POST", "PATCH", "DELETE", "OPTIONS", "M-SEARCH", "get", "A", "PROPPATCHX"]) {
      assert.equal(isHttpMethod(v), true, v);
      assert.equal(assertHttpMethod(v), v);
    }
  });
  test("vide, espaces, contrôle, non ASCII, séparateurs : invalid_format", () => {
    for (const v of ["", " GET", "GET ", "G ET", "GET\n", "GET\r\n", "GE\u0000T", "PÖST", "GET/1", "(GET)", "GET,POST"]) {
      assert.equal(isHttpMethod(v), false, JSON.stringify(v));
      assertRejectsWithout(() => assertHttpMethod(v), v.trim() || undefined, "method", "invalid_format");
    }
  });
  test("plus de 10 caractères : too_long", () => {
    assertRejectsWithout(() => assertHttpMethod("ABCDEFGHIJK"), "ABCDEFGHIJK", "method", "too_long");
    assertRejectsWithout(() => assertHttpMethod("X".repeat(100_000)), "X".repeat(50), "method", "too_long");
  });
  test("types non textuels refusés", () => {
    for (const v of NON_STRINGS) assertRejectsWithout(() => assertHttpMethod(v), undefined, "method", v == null ? "required" : "must_be_string");
  });
});

describe("isErrorCode / assertErrorCode", () => {
  test("motif ^[a-z][a-z0-9_.]{0,63}$ : limites acceptées", () => {
    for (const v of ["a", "timeout", "payment.insufficient_funds", "e2", "a" + "b".repeat(63)]) {
      assert.equal(isErrorCode(v), true, v);
      assert.equal(assertErrorCode(v), v);
    }
  });
  test("majuscule, chiffre ou point en tête, tiret, espace, non ASCII : invalid_format", () => {
    for (const v of ["", "Timeout", "2fa", ".x", "_x", "a-b", "a b", " a", "a\n", "pin=4821é", "ça"]) {
      assert.equal(isErrorCode(v), false, JSON.stringify(v));
      assertRejectsWithout(() => assertErrorCode(v), v.length > 2 ? v : undefined, "errorCode", "invalid_format");
    }
  });
  test("65 caractères : too_long", () => {
    assertRejectsWithout(() => assertErrorCode("a".repeat(65)), "a".repeat(65), "errorCode", "too_long");
  });
});

describe("isSlug / assertSlug", () => {
  test("motif ^[a-z0-9-]{3,60}$ : limites acceptées", () => {
    for (const v of ["abc", "paiement-mobile-generique", "123", "---", "a".repeat(60)]) {
      assert.equal(isSlug(v), true, v);
      assert.equal(assertSlug(v), v);
    }
  });
  test("trop court, majuscules, espaces, soulignés, non ASCII : invalid_format", () => {
    for (const v of ["", "ab", "Abc", "abc ", " abc", "a_b", "abc\n", "été", "a/b"]) {
      assert.equal(isSlug(v), false, JSON.stringify(v));
      assertRejectsWithout(() => assertSlug(v), v.trim().length > 2 ? v : undefined, "slug", "invalid_format");
    }
  });
  test("61 caractères : too_long ; nom de champ personnalisé conservé s'il est conforme", () => {
    assertRejectsWithout(() => assertSlug("a".repeat(61)), "a".repeat(61), "slug", "too_long");
    assertRejectsWithout(() => assertSlug("A", "simulatorSlug"), undefined, "simulatorSlug", "invalid_format");
  });
});

test("un PIN ou une clé passés à n'importe quel validateur n'apparaissent jamais dans l'erreur", () => {
  const PIN = "4821";
  const KEY = "sk_test_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";
  for (const secret of [PIN, KEY, `pin=${PIN}`]) {
    for (const fn of [() => assertUuid(secret, "projectId"), () => assertHttpMethod(` ${secret}`), () => assertErrorCode(secret), () => assertSlug(`${secret} `)]) {
      assert.throws(fn, (err) => {
        assert.ok(err instanceof InvalidInputError);
        for (const text of [err.message, JSON.stringify(err), inspect(err, { showHidden: true })]) assert.ok(!text.includes(secret));
        return true;
      });
    }
  }
});
