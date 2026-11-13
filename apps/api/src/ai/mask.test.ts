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
    assert.equal(maskSensitive("iban sn08 sn01 0015 2000 0485 0000 3035"), "iban [IBAN]", "en minuscules");
    assert.equal(maskSensitive("iban sn08 sn01 0015 2000 0485 0000 3035 pour test"), "iban [IBAN] pour test");
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

  it("masque la valeur qui suit OTP, passcode, code secret, code confidentiel, CVV, CVC", () => {
    assert.equal(maskSensitive("le code OTP 482913 expire"), "le code OTP [SECRET] expire");
    assert.equal(maskSensitive("OTP: 123456"), "OTP: [SECRET]");
    assert.equal(maskSensitive("passcode=9911"), "passcode=[SECRET]");
    assert.equal(maskSensitive("code secret 4321"), "code secret [SECRET]");
    assert.equal(maskSensitive("code confidentiel : 8765"), "code confidentiel : [SECRET]");
    assert.equal(maskSensitive("CVV 123 et cvc: 456"), "CVV [SECRET] et cvc: [SECRET]");
    // Après CVV, un nombre de 3 chiffres est bien masqué (l'exception « code 402 » ne vaut que pour « code »).
    assert.equal(maskSensitive("CVV 402"), "CVV [SECRET]");
  });

  it("masque les clés sk-, ghp_ et github_pat_", () => {
    assert.equal(maskSensitive("clé sk-0a1b2c3d4e5f6a7b8c9d0e1f"), "clé [CLE]");
    assert.equal(maskSensitive("jeton ghp_16C7e42F292c6912E7710c838347Ae178B4a"), "jeton [CLE]");
    assert.equal(
      maskSensitive("jeton github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz"),
      "jeton [CLE]",
    );
    // Pas de faux positif sur des mots ordinaires.
    assert.equal(maskSensitive("un desk-top, le task-runner, sk-8"), "un desk-top, le task-runner, sk-8");
  });

  it("USSD : masque le segment de 4 à 6 chiffres final ou qui suit PIN, jamais le code de service", () => {
    assert.equal(maskSensitive("composer *144*4*1234#"), "composer *144*4*[SECRET]#");
    assert.equal(maskSensitive("*144*1*2*987654#"), "*144*1*2*[SECRET]#");
    assert.equal(maskSensitive("*144*PIN*4455*2#"), "*144*PIN*[SECRET]*2#");
    assert.equal(maskSensitive("code *144*4*1234#"), "code *144*4*[SECRET]#", "le mot « code » ne masque pas tout le code USSD");
    for (const text of ["*144#", "*1441#", "*144*1#", "*144*12#", "*144*123#", "*144*1234567#", "*144*1234*2#"]) {
      assert.equal(maskSensitive(text), text, text);
    }
  });

  // Ce que le masquage NE détecte PAS : comportement constaté, repris dans AI_USAGE.md.
  it("limites connues : données laissées en clair ou faux positifs", () => {
    for (const text of [
      "le client Awa Diop", // noms de personnes
      "née le 12/03/1990", // dates de naissance
      "habite rue 10 x 13, Dakar", // adresses postales
      "valider avec 1234", // PIN sans mot-clé ni format USSD
      "le secret est soleil", // mot de passe sans mot-clé reconnu
      "mot de passe soleil", // valeur sans chiffre, écrite sans « : » ni « = » après le mot-clé
      "code 123", // PIN de 3 chiffres après « code » : confondu avec un code HTTP
      "Mali 76123456", // numéro de 8 chiffres sans séparateur ni 0 initial
    ]) {
      assert.equal(maskSensitive(text), text, text);
    }
    // Faux positif : un nombre groupé sans devise est pris pour un téléphone.
    assert.equal(maskSensitive("10 500 000 transactions"), "[TEL] transactions");
  });

  it("masque plusieurs données dans une même description", () => {
    const masked = maskSensitive("Marchand awa@boutique.sn, tel +221 77 000 11 22, clé sk_test_abcdef123456");
    assert.equal(masked, "Marchand [EMAIL], tel [TEL], clé [CLE]");
  });
});
