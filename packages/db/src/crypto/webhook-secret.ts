// Secrets de signature des webhooks, un par projet, chiffrés en AES-256-GCM avant stockage.
// La clé de chiffrement vient de WEBHOOK_SECRET_KEYS (jamais de la base) :
//   WEBHOOK_SECRET_KEYS="v2:<base64 32 octets>,v1:<base64 32 octets>"
// La première clé chiffre ; toutes les clés listées déchiffrent (rotation sans coupure).
// Données d'authentification (AAD) = identifiant du projet : un texte chiffré copié vers un autre projet est refusé.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const WEBHOOK_SECRET_PREFIX = "whsec_";
const KEY_ID_REGEX = /^v[0-9]{1,6}$/;
const ENCRYPTED_REGEX = /^(v[0-9]{1,6}):([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface WebhookSecretKeyring {
  /** Identifiant de la clé utilisée pour chiffrer (la première de la liste). */
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

export class WebhookSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSecretError";
  }
}

/** Lit et valide la liste de clés. Aucune valeur de clé n'apparaît dans les messages d'erreur. */
export function parseWebhookSecretKeyring(raw: string | undefined): WebhookSecretKeyring {
  if (!raw || raw.trim() === "") throw new WebhookSecretError("WEBHOOK_SECRET_KEYS est absente ou vide.");
  const keys = new Map<string, Buffer>();
  let activeKeyId: string | undefined;
  for (const entry of raw.split(",")) {
    const separator = entry.indexOf(":");
    const id = entry.slice(0, separator).trim();
    const material = entry.slice(separator + 1).trim();
    if (separator < 1 || !KEY_ID_REGEX.test(id)) {
      throw new WebhookSecretError("WEBHOOK_SECRET_KEYS : chaque entrée doit avoir la forme v<n>:<base64>.");
    }
    if (keys.has(id)) throw new WebhookSecretError(`WEBHOOK_SECRET_KEYS : identifiant de clé en double (${id}).`);
    const key = Buffer.from(material, "base64");
    if (key.length !== 32) {
      throw new WebhookSecretError(`WEBHOOK_SECRET_KEYS : la clé ${id} doit faire 32 octets une fois décodée.`);
    }
    keys.set(id, key);
    activeKeyId ??= id;
  }
  return { activeKeyId: activeKeyId!, keys };
}

export function loadWebhookSecretKeyring(env: NodeJS.ProcessEnv = process.env): WebhookSecretKeyring {
  return parseWebhookSecretKeyring(env.WEBHOOK_SECRET_KEYS);
}

/** Nouveau secret de signature, affiché au développeur pour qu'il vérifie les webhooks dans son app. */
export function generateWebhookSecret(): string {
  return WEBHOOK_SECRET_PREFIX + randomBytes(32).toString("base64url");
}

function aad(projectId: string): Buffer {
  return Buffer.from(`hifrica:webhook-secret:${projectId}`, "utf8");
}

export function encryptWebhookSecret(secret: string, projectId: string, keyring: WebhookSecretKeyring): string {
  const key = keyring.keys.get(keyring.activeKeyId);
  if (!key) throw new WebhookSecretError("Clé de chiffrement active introuvable.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(projectId));
  const sealed = Buffer.concat([cipher.update(secret, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${keyring.activeKeyId}:${iv.toString("base64url")}.${sealed.toString("base64url")}`;
}

export function decryptWebhookSecret(encrypted: string, projectId: string, keyring: WebhookSecretKeyring): string {
  const match = ENCRYPTED_REGEX.exec(encrypted);
  if (!match) throw new WebhookSecretError("Secret chiffré mal formé.");
  const [, keyId, ivPart, sealedPart] = match;
  const key = keyring.keys.get(keyId);
  if (!key) throw new WebhookSecretError(`Clé de déchiffrement ${keyId} absente de WEBHOOK_SECRET_KEYS.`);
  const iv = Buffer.from(ivPart, "base64url");
  const sealed = Buffer.from(sealedPart, "base64url");
  if (iv.length !== IV_BYTES || sealed.length <= TAG_BYTES) throw new WebhookSecretError("Secret chiffré mal formé.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(projectId));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    throw new WebhookSecretError("Échec du déchiffrement : clé, projet ou données invalides.");
  }
}

/** Identifiant de la clé qui a chiffré un secret (utile pour un re-chiffrement après rotation). */
export function encryptedWebhookSecretKeyId(encrypted: string): string | null {
  return ENCRYPTED_REGEX.exec(encrypted)?.[1] ?? null;
}
