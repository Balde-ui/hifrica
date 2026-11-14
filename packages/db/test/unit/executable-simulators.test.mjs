// Statuts exécutables et refus des slugs invalides, sans base.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DB_OPERATIONS, EXECUTABLE_SIMULATOR_STATUSES, SIMULATOR_STATUSES, getExecutableSimulator, isExecutableStatus } from "../../dist/index.js";

describe("simulateurs exécutables", () => {
  test("statuts : tout ce qui est publié, jamais unpublished", () => {
    assert.deepEqual([...EXECUTABLE_SIMULATOR_STATUSES], ["draft", "to_verify", "verified"]);
    for (const s of EXECUTABLE_SIMULATOR_STATUSES) assert.ok(SIMULATOR_STATUSES.includes(s), s);
    assert.equal(isExecutableStatus("verified"), true);
    assert.equal(isExecutableStatus("unpublished"), false);
    assert.equal(isExecutableStatus(""), false);
    assert.equal(isExecutableStatus("VERIFIED"), false);
  });

  test("slug invalide → null, aucun accès à la base", async () => {
    const db = new Proxy({}, { get: () => assert.fail("aucun accès à la base attendu") });
    for (const slug of ["", "ab", "UPPER", "a/b", "x".repeat(61)]) assert.equal(await getExecutableSimulator(db, slug), null);
  });

  test("opération get_executable_simulator dans la liste fermée", () => {
    assert.ok(DB_OPERATIONS.includes("get_executable_simulator"));
  });
});
