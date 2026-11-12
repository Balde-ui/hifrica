// Identifiants BIGINT (request_logs.id) : BigInt dans le code, chaîne à l'extérieur du serveur.
// Ne jamais convertir en Number : au-delà de 2^53 la valeur serait silencieusement arrondie.

const MAX_BIGINT = 9223372036854775807n;
const POSITIVE_INTEGER = /^[1-9][0-9]{0,18}$/;

/** Représentation transmise dans l'API, les curseurs et les événements temps réel. */
export function toApiId(id: bigint): string {
  return id.toString();
}

/** Lit un identifiant ou un curseur reçu ; renvoie null s'il est invalide (à traduire en 400). */
export function parseApiId(value: unknown): bigint | null {
  if (typeof value !== "string" || !POSITIVE_INTEGER.test(value)) return null;
  const id = BigInt(value);
  return id <= MAX_BIGINT ? id : null;
}
