import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  WebhookSecretError,
  decryptWebhookSecret,
  encryptWebhookSecret,
  encryptedWebhookSecretKeyId,
  generateWebhookSecret,
  parseWebhookSecretKeyring,
} from "../../dist/index.js";

const newKey = () => randomBytes(32).toString("base64");

test("generateWebhookSecret : préfixe whsec_ et 32 octets aléatoires", () => {
  const secret = generateWebhookSecret();
  assert.match(secret, /^whsec_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(secret, generateWebhookSecret());
});

test("chiffrement puis déchiffrement : on retrouve le secret, le texte chiffré ne le contient pas", () => {
  const keyring = parseWebhookSecretKeyring(`v1:${newKey()}`);
  const projectId = randomUUID();
  const secret = generateWebhookSecret();
  const enc = encryptWebhookSecret(secret, projectId, keyring);
  assert.match(enc, /^v1:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.ok(!enc.includes(secret.slice(6)));
  assert.equal(decryptWebhookSecret(enc, projectId, keyring), secret);
  assert.notEqual(encryptWebhookSecret(secret, projectId, keyring), enc, "IV aléatoire à chaque chiffrement");
});

test("texte chiffré altéré : refusé", () => {
  const keyring = parseWebhookSecretKeyring(`v1:${newKey()}`);
  const projectId = randomUUID();
  const enc = encryptWebhookSecret(generateWebhookSecret(), projectId, keyring);
  const [head, sealed] = enc.split(".");
  const bytes = Buffer.from(sealed, "base64url");
  bytes[0] ^= 0x01;
  assert.throws(() => decryptWebhookSecret(`${head}.${bytes.toString("base64url")}`, projectId, keyring), WebhookSecretError);
});

test("texte chiffré copié vers un autre projet : refusé (AAD)", () => {
  const keyring = parseWebhookSecretKeyring(`v1:${newKey()}`);
  const enc = encryptWebhookSecret(generateWebhookSecret(), randomUUID(), keyring);
  assert.throws(() => decryptWebhookSecret(enc, randomUUID(), keyring), WebhookSecretError);
});

test("mauvaise clé ou clé absente : refusé", () => {
  const projectId = randomUUID();
  const enc = encryptWebhookSecret(generateWebhookSecret(), projectId, parseWebhookSecretKeyring(`v1:${newKey()}`));
  assert.throws(() => decryptWebhookSecret(enc, projectId, parseWebhookSecretKeyring(`v1:${newKey()}`)), WebhookSecretError);
  assert.throws(() => decryptWebhookSecret(enc, projectId, parseWebhookSecretKeyring(`v2:${newKey()}`)), /v1 absente/);
});

test("rotation : la nouvelle clé chiffre, l'ancienne déchiffre encore", () => {
  const k1 = newKey();
  const projectId = randomUUID();
  const secret = generateWebhookSecret();
  const old = encryptWebhookSecret(secret, projectId, parseWebhookSecretKeyring(`v1:${k1}`));
  const rotated = parseWebhookSecretKeyring(`v2:${newKey()},v1:${k1}`);
  assert.equal(decryptWebhookSecret(old, projectId, rotated), secret);
  const fresh = encryptWebhookSecret(secret, projectId, rotated);
  assert.equal(encryptedWebhookSecretKeyId(fresh), "v2");
  assert.equal(encryptedWebhookSecretKeyId(old), "v1");
});

test("WEBHOOK_SECRET_KEYS invalide : erreur explicite, sans divulguer la clé", () => {
  const short = Buffer.alloc(16, 7).toString("base64");
  assert.throws(() => parseWebhookSecretKeyring(undefined), /absente/);
  assert.throws(() => parseWebhookSecretKeyring(""), /absente/);
  assert.throws(() => parseWebhookSecretKeyring(newKey()), /v<n>:<base64>/);
  assert.throws(() => parseWebhookSecretKeyring(`v1:${short}`), (e) => /32 octets/.test(e.message) && !e.message.includes(short));
  const k = newKey();
  assert.throws(() => parseWebhookSecretKeyring(`v1:${k},v1:${k}`), /double/);
  assert.throws(() => decryptWebhookSecret("pas-un-secret", randomUUID(), parseWebhookSecretKeyring(`v1:${k}`)), /mal formé/);
});
