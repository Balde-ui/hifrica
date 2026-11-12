import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskSensitive } from "./mask.js";

describe("maskSensitive", () => {
  it("masque les emails", () => {
    assert.equal(maskSensitive("Contact : awa.diop+test@exemple.sn merci"), "Contact : [EMAIL] merci");
  });

  it("masque les téléphones sénégalais (+221, 00221, 7x xxx xx xx, sans séparateurs)", () => {
    assert.equal(maskSensitive("Appeler +221 77 123 45 67."), "Appeler [TEL].");
    assert.equal(maskSensitive("Appeler 00221771234567."), "Appeler [TEL].");
    assert.equal(maskSensitive("Appeler 77 123 45 67 ou 76-123-45-67"), "Appeler [TEL] ou [TEL]");
    assert.equal(maskSensitive("numéro 781234567"), "numéro [TEL]");
    assert.equal(maskSensitive("fixe 33 822 00 00"), "fixe [TEL]");
    assert.equal(maskSensitive("indicatif 221 70 123 45 67"), "indicatif [TEL]");
  });

  it("masque les téléphones internationaux", () => {
    assert.equal(maskSensitive("France +33 6 12 34 56 78"), "France [TEL]");
    assert.equal(maskSensitive("USA +1 (555) 123-4567"), "USA [TEL]");
    assert.equal(maskSensitive("Mali 0022370123456"), "Mali [TEL]");
  });

  it("masque les clés sk_ / pk_ et les en-têtes Bearer", () => {
    assert.equal(maskSensitive("clé sk_test_51Habc123 et pk_live_XyZ987"), "clé [CLE] et [CLE]");
    assert.equal(maskSensitive("Authorization: Bearer abc.def-123_456"), "Authorization: Bearer [CLE]");
  });

  it("masque les jetons JWT et les chaînes hex/base64 de 32 caractères ou plus", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    assert.equal(maskSensitive(`jeton ${jwt}`), "jeton [CLE]");
    assert.equal(maskSensitive("secret 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"), "secret [CLE]");
    assert.equal(maskSensitive("base64 dGhpcyBpcyBhIHNlY3JldCBrZXkgMTIzNDU2Nzg5MA=="), "base64 [CLE]");
  });

  it("masque les IBAN, avec ou sans espaces", () => {
    assert.equal(maskSensitive("IBAN SN08 SN01 0015 2000 0485 0000 3035 svp"), "IBAN [IBAN] svp");
    assert.equal(maskSensitive("IBAN FR7630006000011234567890189 svp"), "IBAN [IBAN] svp");
  });

  it("masque les numéros de carte valides (Luhn)", () => {
    assert.equal(maskSensitive("carte 4111 1111 1111 1111 exp 12/29"), "carte [CARTE] exp 12/29");
    assert.equal(maskSensitive("carte 5500-0000-0000-0004"), "carte [CARTE]");
  });

  it("ne touche pas au texte métier ordinaire", () => {
    const text =
      "Paiement de 5000 XOF (ou 1 500 000 XOF) sur /v1/checkout/{id} du simulateur paiement-mobile-generique, " +
      "code USSD *144#, délai 30s, version 1.0.0, référence 1234567890123.";
    assert.equal(maskSensitive(text), text);
  });

  it("masque les numéros nationaux africains écrits par groupes ou commençant par 0", () => {
    assert.equal(maskSensitive("Guinée 622 12 34 56"), "Guinée [TEL]");
    assert.equal(maskSensitive("Côte d'Ivoire 07 07 12 34 56"), "Côte d'Ivoire [TEL]");
    assert.equal(maskSensitive("Mali 76 12 34 56"), "Mali [TEL]");
    assert.equal(maskSensitive("Nigeria 0803 123 4567"), "Nigeria [TEL]");
    assert.equal(maskSensitive("points 622.12.34.56 tirets 07-07-12-34-56"), "points [TEL] tirets [TEL]");
    assert.equal(maskSensitive("sans séparateurs 0707123456 et 08031234567"), "sans séparateurs [TEL] et [TEL]");
  });

  it("un nombre suivi de FCFA, XOF, F CFA ou francs est un montant : jamais masqué", () => {
    for (const text of [
      "Plafond de 700000000 XOF",
      "Plafond de 700 000 000 XOF",
      "Montant 76 12 34 56 FCFA",
      "Montant 0707123456 F CFA",
      "Frais de 622 123 456 francs",
      "Total 1.500.000 FCFA ou 25000XOF",
    ]) {
      assert.equal(maskSensitive(text), text);
    }
    // Le montant reste intact, le téléphone voisin est masqué.
    assert.equal(maskSensitive("tel 77 123 45 67, 5000 XOF"), "tel [TEL], 5000 XOF");
  });

  it("masque la valeur qui suit PIN, code, mot de passe, password, mdp", () => {
    assert.equal(maskSensitive("le PIN 1234 du client"), "le PIN [SECRET] du client");
    assert.equal(maskSensitive("PIN 1234."), "PIN [SECRET]", "la ponctuation collée part avec la valeur");
    assert.equal(maskSensitive("code: 9876"), "code: [SECRET]");
    assert.equal(maskSensitive("mot de passe : Soleil2026!"), "mot de passe : [SECRET]");
    assert.equal(maskSensitive("password=hunter2"), "password=[SECRET]");
    assert.equal(maskSensitive("mdp est azerty99"), "mdp est [SECRET]");
    assert.equal(maskSensitive("Code PIN : 0000"), "Code PIN : [SECRET]");
  });

  it("ne masque pas les codes USSD, les codes HTTP ni les phrases sans valeur", () => {
    for (const text of [
      "code USSD *144#",
      "le code *144*1# ouvre le menu",
      "renvoie le code 402 si le solde est insuffisant",
      "le PIN est demandé à la confirmation",
      "le mot de passe doit être changé",
      "un barcode et un codeur",
    ]) {
      assert.equal(maskSensitive(text), text);
    }
  });

  it("masque les préfixes whsec_ et rk_ comme des clés", () => {
    assert.equal(maskSensitive("secret whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"), "secret [CLE]");
    assert.equal(maskSensitive("clé restreinte rk_live_51Habc"), "clé restreinte [CLE]");
  });

  it("masque les emails avec caractères accentués", () => {
    assert.equal(maskSensitive("écrire à awa@école.sn ou à rené.diallo@exemple.ci"), "écrire à [EMAIL] ou à [EMAIL]");
  });

  it("ne prend pas une date pour un numéro de téléphone", () => {
    assert.equal(maskSensitive("le 12-03-2026 ou le 2026.03.12"), "le 12-03-2026 ou le 2026.03.12");
  });

  it("masque plusieurs données dans une même description", () => {
    const masked = maskSensitive("Marchand awa@boutique.sn, tel +221 77 000 11 22, clé sk_test_abcdef123456");
    assert.equal(masked, "Marchand [EMAIL], tel [TEL], clé [CLE]");
  });
});
