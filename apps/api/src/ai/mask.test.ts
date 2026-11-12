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

  it("masque plusieurs données dans une même description", () => {
    const masked = maskSensitive("Marchand awa@boutique.sn, tel +221 77 000 11 22, clé sk_test_abcdef123456");
    assert.equal(masked, "Marchand [EMAIL], tel [TEL], clé [CLE]");
  });
});
