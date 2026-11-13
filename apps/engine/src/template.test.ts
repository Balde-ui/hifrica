import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { render, type TemplateContext } from "./template.js";

const ctx: TemplateContext = {
  body: { amount: 5000, merchant: "Boutique", paid: true, meta: { ref: "R1" }, tags: ["a", "b"], label: "5000" },
  query: { page: "2" },
  params: { id: "123" },
  response: { id: "chk_42", status: "pending", amount: 5000, nested: { code: 7 } },
};

describe("gabarits", () => {
  it("une chaîne réduite à un seul gabarit renvoie la valeur brute avec son type", () => {
    assert.equal(render("{{body.amount}}", ctx), 5000);
    assert.equal(render("{{ body.amount }}", ctx), 5000, "espaces dans les accolades tolérés");
    assert.equal(render("{{body.paid}}", ctx), true);
    assert.deepEqual(render("{{body.meta}}", ctx), { ref: "R1" });
    assert.deepEqual(render("{{body.tags}}", ctx), ["a", "b"]);
    assert.equal(render("{{body.label}}", ctx), "5000", "une chaîne reste une chaîne");
    assert.equal(render("{{params.id}}", ctx), "123");
  });

  it("dès qu'il y a autre chose qu'un seul gabarit, interpolation en texte", () => {
    assert.equal(render("Payer {{body.amount}} FCFA à {{body.merchant}} ?", ctx), "Payer 5000 FCFA à Boutique ?");
    assert.equal(render(" {{body.amount}}", ctx), " 5000");
    assert.equal(render("{{body.amount}}{{body.amount}}", ctx), "50005000");
  });

  it("{{uuid}} et {{now}} restent des chaînes", () => {
    const id = render("{{uuid}}", ctx);
    assert.equal(typeof id, "string");
    assert.match(String(id), /^[0-9a-f-]{36}$/);
    const now = render("{{now}}", ctx);
    assert.equal(typeof now, "string");
    assert.ok(!Number.isNaN(Date.parse(String(now))));
  });

  it("{{response.x}} lit le corps de la réponse déjà rendu", () => {
    assert.equal(render("{{response.id}}", ctx), "chk_42");
    assert.equal(render("{{response.amount}}", ctx), 5000);
    assert.equal(render("{{response.nested.code}}", ctx), 7);
    assert.equal(render("checkout {{response.id}}", ctx), "checkout chk_42");
    assert.deepEqual(
      render({ id: "{{response.id}}", status: "succeeded", amount: "{{body.amount}}" }, ctx),
      { id: "chk_42", status: "succeeded", amount: 5000 },
    );
  });

  it("valeur absente → chaîne vide ; sans réponse dans le contexte, {{response.x}} est vide", () => {
    assert.equal(render("{{body.absent}}", ctx), "");
    assert.equal(render("{{response.id}}", { body: {}, query: {}, params: {} }), "");
    assert.equal(render("{{inconnu.x}}", ctx), "", "racine non autorisée");
  });

  it("ne remonte jamais au prototype des objets", () => {
    assert.equal(render("{{body.constructor}}", ctx), "");
    assert.equal(render("{{body.toString}}", ctx), "");
    assert.equal(render("{{response.__proto__}}", ctx), "");
  });
});
