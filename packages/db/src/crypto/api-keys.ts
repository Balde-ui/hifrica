import { createHash, randomInt } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const API_KEY_PREFIX = "sk_test_";
/** 43 caractères base62 tirés par un générateur cryptographique : ≈ 256 bits d'entropie. */
export const API_KEY_BODY_LENGTH = 43;
export const API_KEY_REGEX = /^sk_test_[0-9A-Za-z]{43}$/;

export interface GeneratedApiKey {
  /** Clé complète : à montrer UNE SEULE FOIS à l'utilisateur, jamais stockée ni journalisée. */
  key: string;
  /** SHA-256 de la clé complète (32 octets) : seule valeur stockée (api_keys.key_hash). */
  hash: Buffer;
  /** "sk_test_" + 4 caractères, pour l'affichage. */
  prefix: string;
  /** 4 derniers caractères, pour l'affichage. */
  last4: string;
}

export function generateApiKey(): GeneratedApiKey {
  let body = "";
  for (let i = 0; i < API_KEY_BODY_LENGTH; i++) body += ALPHABET[randomInt(ALPHABET.length)];
  const key = API_KEY_PREFIX + body;
  return { key, hash: hashApiKey(key), prefix: key.slice(0, API_KEY_PREFIX.length + 4), last4: key.slice(-4) };
}

/**
 * Empreinte SHA-256. Un hachage lent (bcrypt, argon2) n'apporte rien pour une clé aléatoire de 256 bits,
 * et un hachage rapide permet au moteur une recherche directe par index unique.
 */
export function hashApiKey(key: string): Buffer {
  return createHash("sha256").update(key, "utf8").digest();
}

/** Vérifie le format avant toute requête SQL (évite d'interroger la base pour des clés manifestement fausses). */
export function isWellFormedApiKey(value: unknown): value is string {
  return typeof value === "string" && API_KEY_REGEX.test(value);
}
