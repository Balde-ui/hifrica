// Validation des entrées de la couche d'accès aux données (conception C4, §2.2).
//
// Règles :
// - les fonctions REJETTENT au lieu de corriger : pas de trim, pas de mise en minuscules, pas de
//   conversion de type, pas de troncature. Une valeur entourée d'espaces est invalide ;
// - les motifs reproduisent (ou resserrent) les CHECK de la base, pour échouer tôt, avant le SQL ;
// - une erreur ne contient JAMAIS la valeur rejetée : seulement le nom du champ et une règle prise
//   dans une liste fermée (InvalidInputError).
import { InvalidInputError } from "./errors.js";

/**
 * uuid au format canonique 8-4-4-4-12, chiffres hexadécimaux en minuscules OU majuscules.
 * Toutes versions acceptées (v4 de gen_random_uuid, v4 du moteur, uuid de Better Auth).
 * PostgreSQL accepte d'autres écritures (accolades, sans tirets) : elles sont refusées ici, exprès.
 * Un uuid en majuscules est valide : PostgreSQL le normalise, ce n'est pas une donnée corrigée.
 */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Méthode HTTP : jeton au sens de la RFC 9110 (§5.6.2, « tchar »), 1 à 10 caractères.
 * Plus strict que le CHECK `request_logs_method_chk` (longueur 1 à 10 seulement) : ni espace,
 * ni caractère de contrôle, ni caractère non ASCII. La casse n'est pas modifiée.
 */
export const HTTP_METHOD_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,10}$/;
export const HTTP_METHOD_MAX_LENGTH = 10;

/** Code d'erreur métier : identique au CHECK `request_logs_error_code_chk`. */
export const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_.]{0,63}$/;
export const ERROR_CODE_MAX_LENGTH = 64;

/** Slug de simulateur : identique au CHECK `simulators_slug_chk`. */
export const SLUG_PATTERN = /^[a-z0-9-]{3,60}$/;
export const SLUG_MAX_LENGTH = 60;

// Note : sans le drapeau `m`, `$` ne correspond qu'à la toute fin de la chaîne en JavaScript
// (comme `$` dans les expressions régulières de PostgreSQL) : "abc\n" est donc refusé des deux côtés.

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isHttpMethod(value: unknown): value is string {
  return typeof value === "string" && HTTP_METHOD_PATTERN.test(value);
}

export function isErrorCode(value: unknown): value is string {
  return typeof value === "string" && ERROR_CODE_PATTERN.test(value);
}

export function isSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG_PATTERN.test(value);
}

/** true si `value` compte plus de `max` points de code ; s'arrête au premier dépassement. */
function exceeds(value: string, max: number): boolean {
  let n = 0;
  for (const _ of value) if (++n > max) return true;
  return false;
}

/** Vérifie le type et la longueur, puis le motif ; lève InvalidInputError sans la valeur. */
function check(value: unknown, field: string, test: (v: string) => boolean, maxLength?: number): string {
  if (typeof value !== "string") {
    throw new InvalidInputError(field, value === undefined || value === null ? "required" : "must_be_string");
  }
  // Longueur mesurée en points de code (comme char_length de PostgreSQL), arrêtée dès la limite.
  if (maxLength !== undefined && value.length > maxLength && exceeds(value, maxLength)) {
    throw new InvalidInputError(field, "too_long");
  }
  if (!test(value)) throw new InvalidInputError(field, "invalid_format");
  return value;
}

/** Renvoie la valeur inchangée si c'est un uuid ; sinon InvalidInputError(field, required | must_be_string | must_be_uuid). */
export function assertUuid(value: unknown, field: string): string {
  if (typeof value !== "string") return check(value, field, () => false);
  if (!UUID_PATTERN.test(value)) throw new InvalidInputError(field, "must_be_uuid");
  return value;
}

export function assertHttpMethod(value: unknown, field = "method"): string {
  return check(value, field, (v) => HTTP_METHOD_PATTERN.test(v), HTTP_METHOD_MAX_LENGTH);
}

export function assertErrorCode(value: unknown, field = "errorCode"): string {
  return check(value, field, (v) => ERROR_CODE_PATTERN.test(v), ERROR_CODE_MAX_LENGTH);
}

export function assertSlug(value: unknown, field = "slug"): string {
  return check(value, field, (v) => SLUG_PATTERN.test(v), SLUG_MAX_LENGTH);
}
