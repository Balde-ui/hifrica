import { test } from "node:test";
import assert from "node:assert/strict";
import { API_KEY_REGEX, generateApiKey, hashApiKey, isWellFormedApiKey } from "../../dist/index.js";

test("generateApiKey : format sk_test_ + 43 caractères base62, empreinte de 32 octets", () => {
  const { key, hash, prefix, last4 } = generateApiKey();
  assert.match(key, API_KEY_REGEX);
  assert.equal(hash.length, 32);
  assert.equal(prefix, key.slice(0, 12));
  assert.match(prefix, /^sk_test_[0-9A-Za-z]{4}$/);
  assert.equal(last4, key.slice(-4));
  assert.deepEqual(hash, hashApiKey(key));
});

test("hashApiKey : déterministe et sensible à chaque caractère", () => {
  const { key } = generateApiKey();
  assert.deepEqual(hashApiKey(key), hashApiKey(key));
  const altered = key.slice(0, -1) + (key.at(-1) === "a" ? "b" : "a");
  assert.notDeepEqual(hashApiKey(key), hashApiKey(altered));
});

test("generateApiKey : aucune collision sur 10 000 clés", () => {
  const seen = new Set();
  for (let i = 0; i < 10_000; i++) seen.add(generateApiKey().key);
  assert.equal(seen.size, 10_000);
});

test("isWellFormedApiKey : rejette les formats invalides avant toute requête SQL", () => {
  assert.equal(isWellFormedApiKey(generateApiKey().key), true);
  for (const bad of [undefined, null, 42, "", "sk_test_", "sk_live_" + "a".repeat(43), "sk_test_" + "a".repeat(42), "sk_test_" + "a".repeat(44), "sk_test_" + "-".repeat(43)]) {
    assert.equal(isWellFormedApiKey(bad), false, String(bad));
  }
});
