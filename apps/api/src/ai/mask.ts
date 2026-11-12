// Propriétaire : Dev A
// Masquage des données sensibles d'un texte AVANT tout envoi à un fournisseur d'IA.

interface MaskRule {
  label: string;
  pattern: RegExp;
  /** Filtre optionnel : la correspondance n'est masquée que s'il renvoie true. */
  accept?: (match: string) => boolean;
  /** Remplacement personnalisé (par défaut : le label). */
  replace?: (match: string, ...groups: string[]) => string;
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

// L'ordre compte : les motifs les plus spécifiques passent en premier.
const RULES: MaskRule[] = [
  // Emails
  { label: "[EMAIL]", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // Jetons JWT
  { label: "[CLE]", pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  // En-tête Bearer : on garde le mot, on masque le jeton
  {
    label: "[CLE]",
    pattern: /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{6,}/gi,
    replace: (_m, word) => `${word} [CLE]`,
  },
  // Clés de type sk_..., pk_..., rk_... (test ou live)
  { label: "[CLE]", pattern: /\b(?:sk|pk|rk)_[A-Za-z0-9_-]{4,}/g },
  // IBAN (groupes de 4, avec ou sans espaces)
  {
    label: "[IBAN]",
    pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g,
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
  {
    label: "[CARTE]",
    pattern: /\b\d(?:[ -]?\d){12,18}\b/g,
    accept: (m) => luhnValid(digits(m)),
  },
  // Téléphones sénégalais sans indicatif : 77 123 45 67, 771234567, 33 822 00 00, 221 77 123 45 67
  { label: "[TEL]", pattern: /(?<![\d+])(?:221[ .-]?)?(?:7[05-8]|3[03])(?:[ .-]?\d){7}(?!\d)/g },
  // Chaînes hexadécimales ou base64 de 32 caractères ou plus (clés, secrets)
  {
    label: "[CLE]",
    pattern: /[A-Za-z0-9+/_=-]{32,}/g,
    accept: (m) => /^[0-9a-fA-F]{32,}$/.test(m) || (/\d/.test(m) && /[a-z]/.test(m) && /[A-Z]/.test(m)),
  },
];

/** Remplace emails, téléphones, clés et jetons, IBAN et numéros de carte par [EMAIL], [TEL], [CLE], [IBAN], [CARTE]. */
export function maskSensitive(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      if (rule.accept && !rule.accept(match)) return match;
      if (rule.replace) {
        const groups = rest.filter((g): g is string => typeof g === "string");
        return rule.replace(match, ...groups);
      }
      return rule.label;
    });
  }
  return out;
}
