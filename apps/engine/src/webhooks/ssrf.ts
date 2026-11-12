// Propriétaire : Dev A
// Protection SSRF des webhooks : seules les adresses publiques sont joignables.
// Le contrôle se fait dans `lookup`, donc au moment de la connexion : l'adresse vérifiée est celle
// à laquelle on se connecte réellement (protège du DNS rebinding).
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { isIP, type LookupFunction } from "node:net";

/** Plages IPv4 privées ou réservées : [adresse de base, longueur du préfixe]. */
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // « ce réseau »
  ["10.0.0.0", 8], // privé
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // boucle locale
  ["169.254.0.0", 16], // lien local (dont 169.254.169.254, métadonnées cloud)
  ["172.16.0.0", 12], // privé
  ["192.0.0.0", 24], // affectations IETF
  ["192.168.0.0", 16], // privé
  ["198.18.0.0", 15], // tests de performance
  ["224.0.0.0", 4], // multicast ; 240/4 et 255.255.255.255 sont bloqués par la règle « >= 224 »
];

/** Adresse IPv4 en entier non signé, ou null si la chaîne n'est pas une IPv4 décimale pointée. */
export function parseIPv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

/** Adresse IPv6 en 8 mots de 16 bits (gère "::", la zone %eth0 et l'IPv4 en fin d'adresse), ou null. */
export function parseIPv6(input: string): number[] | null {
  let ip = input.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  // IPv4 en fin d'adresse (::ffff:127.0.0.1) : converti en deux mots de 16 bits.
  const v4Match = ip.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Match) {
    const v4 = parseIPv4(v4Match[1]);
    if (v4 === null) return null;
    ip = ip.slice(0, -v4Match[1].length) + `${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const words = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const out: number[] = [];
  for (const w of words) {
    if (!/^[0-9a-f]{1,4}$/.test(w)) return null;
    out.push(parseInt(w, 16));
  }
  return out;
}

function isBlockedV4(value: number): boolean {
  if (value >= 0xe0000000) return true; // 224.0.0.0 et au-delà
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((value & mask) >>> 0) === ((parseIPv4(base) ?? 0) & mask) >>> 0;
  });
}

function isBlockedV6(w: number[]): boolean {
  const v4Tail = ((w[6] << 16) | w[7]) >>> 0;
  // ::x.x.x.x (dont :: et ::1) et ::ffff:x.x.x.x (IPv4 mappée) : vérifiées comme de l'IPv4.
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0 || w[5] === 0xffff)) return isBlockedV4(v4Tail);
  // 64:ff9b::/96 (NAT64) : traduit vers l'IPv4 embarquée, vérifiée comme de l'IPv4.
  if (w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) return isBlockedV4(v4Tail);
  if ((w[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 (adresses locales uniques)
  if ((w[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 (lien local)
  if ((w[0] & 0xff00) === 0xff00) return true; // ff00::/8 (multicast)
  return false;
}

/** true si l'adresse est privée, réservée ou illisible (par prudence, on refuse ce qu'on ne sait pas lire). */
export function isBlockedAddress(address: string): boolean {
  const clean = address.replace(/^\[|\]$/g, "");
  const family = isIP(clean.split("%")[0]);
  if (family === 4) return isBlockedV4(parseIPv4(clean) ?? 0);
  if (family === 6) {
    const words = parseIPv6(clean);
    return words === null || isBlockedV6(words);
  }
  return true;
}

export class SsrfBlockedError extends Error {
  readonly code = "ERR_HIFRICA_SSRF_BLOCKED";
  constructor(readonly host: string) {
    super(`destination refusée (adresse privée ou réservée) : ${host}`);
    this.name = "SsrfBlockedError";
  }
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: "invalid_url" | "scheme" | "address" };

/** Contrôle avant connexion : schéma http(s) et, si l'URL contient une IP littérale, adresse publique. */
export function checkWebhookUrl(raw: string, allowPrivate: boolean): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "scheme" };
  // Node ne passe pas par `lookup` pour une IP littérale : on la vérifie ici.
  // (L'analyseur d'URL normalise déjà 0x7f000001, 2130706433, etc. en 127.0.0.1.)
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate && isIP(host) !== 0 && isBlockedAddress(host)) return { ok: false, reason: "address" };
  return { ok: true, url };
}

/** `lookup` pour http.request : résout le nom puis refuse si UNE des adresses est privée ou réservée. */
export function createSafeLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    // On résout toujours TOUTES les adresses pour toutes les vérifier, quel que soit options.all.
    const all: LookupOptions & { all: true } = { ...options, all: true };
    dnsLookup(hostname, all, (err, addresses: LookupAddress[]) => {
      if (err) return callback(err, "", 0);
      if (addresses.length === 0) {
        return callback(Object.assign(new Error(`aucune adresse pour ${hostname}`), { code: "ENOTFOUND" }), "", 0);
      }
      if (!allowPrivate && addresses.some((a) => isBlockedAddress(a.address))) {
        return callback(new SsrfBlockedError(hostname), "", 0);
      }
      if (options.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}
