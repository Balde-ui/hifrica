// Tests C5 : `executable` du résumé de simulateur suit exactement les conditions du moteur (#28).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { EXECUTABLE_SIMULATOR_STATUSES, SIMULATOR_STATUSES } from "@hifrica/db";
import { summarize, type SimulatorRow } from "./simulator-summary.js";

const YAML = `name: demo-paiement
version: 1.0.0
description: Démo
kind: http
auth: bearer
endpoints:
  - id: pay
    method: POST
    path: /v1/pay
    response:
      status: 201
      body: { id: "{{uuid}}" }
scenarios:
  refus:
    endpoint: pay
    response:
      status: 402
      body: { error: "refus" }
`;

function row(over: Partial<SimulatorRow> = {}): SimulatorRow {
  return {
    slug: "demo-paiement",
    kind: "http",
    description: "Démo",
    origin: "manual",
    status: "draft",
    publishedAt: new Date("2026-11-14T10:00:00Z"),
    version: "1.0.0",
    yaml: YAML,
    ...over,
  };
}

describe("summarize : executable", () => {
  it("brouillon publié, à vérifier et vérifié : exécutables", () => {
    for (const status of ["draft", "to_verify", "verified"]) {
      assert.equal(summarize(row({ status })).executable, true, status);
    }
    assert.equal(summarize(row({ status: "to_verify", origin: "ai" })).executable, true);
  });

  it("chaque statut connu suit EXECUTABLE_SIMULATOR_STATUSES du moteur", () => {
    for (const status of SIMULATOR_STATUSES) {
      const expected = (EXECUTABLE_SIMULATOR_STATUSES as readonly string[]).includes(status);
      assert.equal(summarize(row({ status })).executable, expected, status);
    }
  });

  it("dépublié ou statut inconnu : non exécutable", () => {
    assert.equal(summarize(row({ status: "unpublished" })).executable, false);
    assert.equal(summarize(row({ status: "archived" })).executable, false);
    assert.equal(summarize(row({ status: "" })).executable, false);
  });

  it("jamais publié (published_at nul) : non exécutable", () => {
    assert.equal(summarize(row({ publishedAt: null })).executable, false);
  });

  it("sans version courante ou sans YAML : non exécutable", () => {
    assert.equal(summarize(row({ version: null })).executable, false);
    assert.equal(summarize(row({ yaml: null })).executable, false);
    assert.equal(summarize(row({ yaml: "" })).executable, false);
  });

  it("YAML invalide selon le schéma : non exécutable, champs vides", () => {
    const s = summarize(row({ yaml: "name: demo-paiement\nversion: 1.0.0\nkind: http\nendpoints: oui\n" }));
    assert.equal(s.executable, false);
    assert.deepEqual(s.endpoints, []);
    assert.deepEqual(s.scenarios, []);
    assert.equal(summarize(row({ yaml: "::: pas du yaml :::\n\t- [" })).executable, false);
  });

  it("name du YAML différent du slug : non exécutable", () => {
    assert.equal(summarize(row({ slug: "autre-slug" })).executable, false);
  });

  it("autres champs inchangés", () => {
    const s = summarize(row({ forkedFrom: "parent" }));
    assert.deepEqual(s.endpoints, [{ id: "pay", method: "POST", path: "/v1/pay" }]);
    assert.deepEqual(s.scenarios, ["refus"]);
    assert.equal(s.menus, 0);
    assert.equal(s.code, null);
    assert.equal(s.forkedFrom, "parent");
    assert.equal(s.version, "1.0.0");
    assert.equal(summarize(row()).forkedFrom, null);
  });

  it("simulateurs livrés avec le dépôt (statut verified) : exécutables", () => {
    for (const file of ["paiement-mobile-generique", "mobile-money-ussd", "otp-sms"]) {
      const yaml = readFileSync(new URL(`../../../simulators/${file}.yaml`, import.meta.url), "utf8");
      const kind = file === "mobile-money-ussd" ? "ussd" : "http";
      const s = summarize(row({ slug: file, kind, status: "verified", yaml }));
      assert.equal(s.executable, true, file);
    }
  });
});
