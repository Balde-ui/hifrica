import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AiQuota, clientKey, FallbackStore, MemoryStore, type CounterStore } from "./quota.js";

describe("clé de quota", () => {
  it("IPv4 : l'adresse entière", () => {
    assert.equal(clientKey("198.51.100.7"), "198.51.100.7");
  });

  it("IPv6 : le préfixe /64, quelle que soit l'écriture", () => {
    const key = "2001:db8:abcd:12::/64";
    for (const ip of [
      "2001:db8:abcd:12::1",
      "2001:db8:abcd:12:ffff:ffff:ffff:ffff",
      "2001:0DB8:ABCD:0012:0000:0000:0000:0001",
      "[2001:db8:abcd:12::99]",
      "2001:db8:abcd:12::5%eth0",
    ]) {
      assert.equal(clientKey(ip), key, ip);
    }
    assert.notEqual(clientKey("2001:db8:abcd:13::1"), key);
  });

  it("IPv4 mappée (::ffff:) → IPv4, en décimal pointé comme en hexadécimal", () => {
    assert.equal(clientKey("::ffff:198.51.100.7"), "198.51.100.7");
    assert.equal(clientKey("::ffff:c633:6407"), "198.51.100.7");
  });
});

describe("compteurs", () => {
  it("MemoryStore : fenêtre fixe à partir du premier appel", async () => {
    let now = 0;
    const store = new MemoryStore(() => now);
    assert.deepEqual(await store.incr("k", 60), { count: 1, ttlSec: 60 });
    now = 30_000;
    assert.deepEqual(await store.incr("k", 60), { count: 2, ttlSec: 30 });
    now = 60_000;
    assert.deepEqual(await store.incr("k", 60), { count: 1, ttlSec: 60 });
  });

  it("FallbackStore : bascule en mémoire si le stockage principal échoue, avertit une seule fois", async () => {
    const failing: CounterStore = {
      incr: async () => {
        throw new Error("Stream isn't writeable");
      },
      close: async () => undefined,
    };
    const warnings: unknown[] = [];
    const store = new FallbackStore(failing, new MemoryStore(), { warn: (o: unknown) => void warnings.push(o) } as never);
    const quota = new AiQuota({ store, perClientLimit: 2 });
    assert.deepEqual(await quota.consume("198.51.100.1"), { ok: true });
    assert.deepEqual(await quota.consume("198.51.100.1"), { ok: true });
    const third = await quota.consume("198.51.100.1");
    assert.equal(third.ok, false);
    assert.equal(warnings.length, 1, "avertissement limité");
  });
});
