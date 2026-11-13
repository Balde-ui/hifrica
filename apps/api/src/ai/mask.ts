// Propriétaire : Dev A
// Masquage des données sensibles d'un texte AVANT tout envoi à un fournisseur d'IA.
// Masquage PARTIEL : les noms de personnes et les dates de naissance ne sont pas détectés.

interface MaskRule {
  label: string;
  pattern: RegExp;
  /** Filtre optionnel : la correspondance n'est masquée que s'il renvoie true. */
  accept?: (match: string, groups: string[]) => boolean;
  /** Remplacement personnalisé (par défaut : le label). */
  replace?: (match: string, groups: string[]) => string;
}

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

/** Clé de Luhn : écarte la plupart des suites de chiffres qui ne sont pas des numéros de carte. */
function luhnValid(num: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = Number(num[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Ressemble à une date (12/03/2024, 12-03-2024, 2024.03.12) : pas un numéro de téléphone. */
function looksLikeDate(m: string): boolean {
  return /^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(m) || /^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(m);
}

/** Valeur derrière un mot-clé de secret : on écarte les codes USSD (*144#) et les codes HTTP (code 402). */
function isSecretValue(keyword: string, separator: string, value: string): boolean {
  if (/^\*[\d*]+#$/.test(value)) return false;
  const explicit = /[:=]/.test(separator);
  if (/^code$/i.test(keyword) && /^[1-5]\d\d$/.test(value)) return false;
  // Sans « : » ni « = », on ne masque que des valeurs qui contiennent un chiffre (« le PIN est demandé » reste lisible).
  return explicit || /\d/.test(value);
}

// Montant : nombre (éventuellement groupé par milliers) directement suivi d'une devise CFA. Jamais masqué.
const AMOUNT = /(?<![\d.,])(?:\d{1,3}(?:[   .]\d{3})+|\d+)(?:[.,]\d{1,2})?\s?(?:F\s?CFA|FCFA|XOF|francs?)(?![\p{L}\d])/giu;

// L'ordre compte : les motifs les plus spécifiques passent en premier.
const RULES: MaskRule[] = [
  // Emails, y compris accentués (awa@école.sn)
  { label: "[EMAIL]", pattern: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu },
  // Jetons JWT
  { label: "[CLE]", pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  // En-tête Bearer : on garde le mot, on masque le jeton
  { label: "[CLE]", pattern: /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{6,}/gi, replace: (_m, [word]) => `${word} [CLE]` },
  // Clés sk_..., pk_..., rk_..., whsec_...
  { label: "[CLE]", pattern: /\b(?:sk|pk|rk|whsec)_[A-Za-z0-9_+/=-]{4,}/g },
  // Clés sk-... (DeepSeek, OpenAI...) et jetons GitHub ghp_..., github_pat_...
  { label: "[CLE]", pattern: /\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{8,}/g },
  // Valeur après « PIN », « OTP », « code », « code secret », « code confidentiel », « passcode »,
  // « mot de passe », « password », « mdp », « CVV », « CVC » → [SECRET].
  // La valeur va jusqu'au prochain espace, virgule ou point-virgule : mieux vaut masquer une ponctuation
  // de trop que laisser fuir la fin d'un mot de passe (« Soleil2026! »).
  {
    label: "[SECRET]",
    // La valeur ne peut pas être elle-même un mot-clé : dans « Code PIN : 0000 », c'est « PIN : 0000 » qui compte.
    pattern:
      /(?<![\p{L}\p{N}_])(code secret|code confidentiel|mot de passe|passcode|password|PIN|OTP|CVV|CVC|code|mdp)(?![\p{L}\p{N}_])(\s*(?:[:=]|est|is)?\s*)(?!(?:PIN|OTP|CVV|CVC|code|mot|passcode|password|mdp)(?![\p{L}\p{N}_]))([^\s,;]+)/giu,
    accept: (_m, [keyword, separator, value]) => isSecretValue(keyword, separator, value),
    replace: (_m, [keyword, separator]) => `${keyword}${separator}[SECRET]`,
  },
  // Dans un code USSD (*144*4*1234#) : un segment de 4 à 6 chiffres qui suit « PIN » ou qui est le dernier
  // avant # est masqué (*144*4*[SECRET]#). Le code de service (premier segment) n'est jamais touché.
  // Placé APRÈS la règle des secrets, qui laisse intacts les codes USSD (« code *144*4*1234# »).
  {
    label: "[SECRET]",
    pattern: /\*(\d{1,6})((?:\*[\p{L}\d]+)+)#/gu,
    replace: (_m, [service, rest]) => {
      const segments = rest.slice(1).split("*");
      const masked = segments.map((seg, i) => {
        const isPinValue = i > 0 && /^pin$/i.test(segments[i - 1]);
        return /^\d{4,6}$/.test(seg) && (isPinValue || i === segments.length - 1) ? "[SECRET]" : seg;
      });
      return `*${service}*${masked.join("*")}#`;
    },
  },
  // IBAN (groupes de 4, avec ou sans espaces, majuscules ou minuscules). Un groupe en minuscules doit
  // contenir un chiffre (sn01), pour ne pas avaler le mot qui suit l'IBAN (« ... 3035 pour »).
  {
    label: "[IBAN]",
    pattern:
      /\b[A-Za-z]{2}\d{2}(?: ?(?:(?=[A-Za-z]{0,3}\d)[A-Za-z0-9]{4}|[A-Z]{4})){2,7}(?: ?(?:(?=[A-Za-z]{0,3}\d)[A-Za-z0-9]{1,4}|[A-Z]{1,4}))?\b/g,
    accept: (m) => m.replace(/\s/g, "").length >= 15 && /\d{4}/.test(m.slice(4)),
  },
  // Téléphones internationaux : +221 77 123 45 67, 00221771234567, +33 6 12 34 56 78, +1 (555) 123-4567
  {
    label: "[TEL]",
    pattern: /(?<![\w+])(?:\+|00)[1-9](?:[ .()-]{0,2}\d){7,14}(?!\d)/g,
    accept: (m) => {
      const n = digits(m).length;
      return n >= 8 && n <= 17;
    },
  },
  // Numéros de carte (13 à 19 chiffres, espaces ou tirets, clé de Luhn valide)
  { label: "[CARTE]", pattern: /\b\d(?:[ -]?\d){12,18}\b/g, accept: (m) => luhnValid(digits(m)) },
  // Téléphones sénégalais sans indicatif : 77 123 45 67, 771234567, 33 822 00 00, 221 77 123 45 67
  { label: "[TEL]", pattern: /(?<![\d+])(?:221[ .-]?)?(?:7[05-8]|3[03])(?:[ .-]?\d){7}(?!\d)/g },
  // Numéros nationaux écrits par groupes : 622 12 34 56 (Guinée), 07 07 12 34 56 (Côte d'Ivoire),
  // 76 12 34 56 (Mali), 0803 123 4567 (Nigeria). 8 à 11 chiffres ; les dates sont écartées.
  {
    label: "[TEL]",
    pattern: /(?<![\d+.,])\d{2,4}(?:[ .-]\d{2,4}){2,4}(?![\d])/g,
    accept: (m) => {
      const n = digits(m).length;
      return n >= 8 && n <= 11 && !looksLikeDate(m);
    },
  },
  // Numéros nationaux commençant par 0, sans séparateurs : 0707123456, 08031234567
  { label: "[TEL]", pattern: /(?<![\d+])0\d{7,10}(?!\d)/g },
  // Chaînes hexadécimales ou base64 de 32 caractères ou plus (clés, secrets)
  {
    label: "[CLE]",
    pattern: /[A-Za-z0-9+/_=-]{32,}/g,
    accept: (m) => /^[0-9a-fA-F]{32,}$/.test(m) || (/\d/.test(m) && /[a-z]/.test(m) && /[A-Z]/.test(m)),
  },
];

// Marqueurs des montants protégés : caractères à usage privé et index en lettres (aucun chiffre),
// pour qu'aucune règle ne puisse les toucher.
const OPEN = "";
const CLOSE = "";
/** Index en base 26 écrit avec A à Z (0 → A, 25 → Z, 26 → BA). */
function toLetters(n: number): string {
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  } while (n > 0);
  return out;
}

function fromLetters(s: string): number {
  return [...s].reduce((acc, c) => acc * 26 + (c.charCodeAt(0) - 65), 0);
}

/**
 * Remplace emails, téléphones, clés et jetons, IBAN, numéros de carte et secrets par [EMAIL], [TEL],
 * [CLE], [IBAN], [CARTE], [SECRET]. Les montants suivis d'une devise CFA ne sont jamais masqués.
 * Limites connues (voir les tests « limites connues » et AI_USAGE.md) : noms, dates de naissance,
 * adresses, secrets écrits sans mot-clé, etc. ne sont pas détectés.
 */
export function maskSensitive(text: string): string {
  const amounts: string[] = [];
  let out = text.replace(AMOUNT, (m) => {
    amounts.push(m);
    return `${OPEN}${toLetters(amounts.length - 1)}${CLOSE}`;
  });
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      // Arguments de replace : groupes capturés, puis position (nombre), puis chaîne entière.
      const offsetIndex = rest.findIndex((r) => typeof r === "number");
      const groups = rest.slice(0, offsetIndex === -1 ? rest.length : offsetIndex).map((g) => (typeof g === "string" ? g : ""));
      if (rule.accept && !rule.accept(match, groups)) return match;
      return rule.replace ? rule.replace(match, groups) : rule.label;
    });
  }
  return out.replace(new RegExp(`${OPEN}([A-Z]+)${CLOSE}`, "g"), (_m, key: string) => amounts[fromLetters(key)] ?? "");
}
