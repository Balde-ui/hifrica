import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkWebhookUrl, createSafeLookup, isBlockedAddress, parseIPv6, SsrfBlockedError } from "./ssrf.js";

describe("SSRF : adresses", () => {
  it("refuse les IPv4 privées ou réservées", () => {
    for (const ip of [
      "0.0.0.0", "0.255.255.255", "10.0.0.1", "10.255.255.255", "100.64.0.1", "100.127.255.255", "127.0.0.1",
      "127.1.2.3", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.8", "192.168.1.10", "198.18.0.1",
      "198.19.255.255", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255",
    ]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
  });

  it("autorise les IPv4 publiques, y compris juste à côté des plages réservées", () => {
    for (const ip of [
      "8.8.8.8", "1.1.1.1", "93.184.216.34", "41.82.0.1", "9.255.255.255", "11.0.0.0", "100.63.255.255",
      "100.128.0.0", "172.15.255.255", "172.32.0.0", "192.0.1.1", "192.167.255.255", "192.169.0.0",
      "198.17.255.255", "198.20.0.0", "223.255.255.255",
    ]) {
      assert.equal(isBlockedAddress(ip), false, ip);
    }
  });

  it("refuse les IPv6 réservées et les IPv4 mappées privées", () => {
    for (const ip of [
      "::", "::1", "[::1]", "fc00::1", "fd12:3456:789a::1", "fe80::1", "fe80::1%eth0", "febf::1", "ff02::1",
      "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:192.168.0.1",
      "::127.0.0.1", "64:ff9b::10.0.0.1",
    ]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
  });

  it("autorise les IPv6 publiques et les IPv4 mappées publiques", () => {
    for (const ip of ["2001:4860:4860::8888", "2606:4700:4700::1111", "2a00:1450:4007:80e::200e", "::ffff:8.8.8.8", "::ffff:808:808"]) {
      assert.equal(isBlockedAddress(ip), false, ip);
    }
  });

  it("refuse ce qui n'est pas une adresse IP lisible", () => {
    for (const value of ["", "localhost", "example.com", "1.2.3", "1.2.3.256", ":::1", "12345::"]) {
      assert.equal(isBlockedAddress(value), true, value);
    }
  });

  it("parseIPv6 développe correctement les formes compressées", () => {
    assert.deepEqual(parseIPv6("::1"), [0, 0, 0, 0, 0, 0, 0, 1]);
    assert.deepEqual(parseIPv6("2001:db8::8:800:200c:417a"), [0x2001, 0xdb8, 0, 0, 0x8, 0x800, 0x200c, 0x417a]);
    assert.deepEqual(parseIPv6("::ffff:127.0.0.1"), [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    assert.equal(parseIPv6("1::2::3"), null);
  });
});

describe("SSRF : URL", () => {
  it("refuse les schémas autres que http: et https:", () => {
    for (const url of ["ftp://example.com/hook", "file:///etc/passwd", "gopher://example.com", "javascript:alert(1)"]) {
      assert.deepEqual(checkWebhookUrl(url, false), { ok: false, reason: "scheme" }, url);
    }
    assert.deepEqual(checkWebhookUrl("pas une url", false), { ok: false, reason: "invalid_url" });
  });

  it("refuse une URL contenant directement une IP privée, sous toutes ses écritures", () => {
    for (const url of [
      "http://127.0.0.1/hook", "http://10.0.0.5:8080/hook", "https://169.254.169.254/latest/meta-data",
      "http://[::1]/hook", "http://[::ffff:127.0.0.1]/hook", "http://0x7f000001/hook", "http://2130706433/hook",
      "http://0177.0.0.1/hook", "http://127.1/hook", "http://0/hook",
    ]) {
      const result = checkWebhookUrl(url, false);
      assert.equal(result.ok, false, url);
      assert.equal(!result.ok && result.reason, "address", url);
    }
  });

  it("accepte une IP publique littérale ou un nom d'hôte (vérifié ensuite dans lookup)", () => {
    assert.equal(checkWebhookUrl("https://8.8.8.8/hook", false).ok, true);
    assert.equal(checkWebhookUrl("https://[2001:4860:4860::8888]/hook", false).ok, true);
    assert.equal(checkWebhookUrl("https://hooks.exemple.test/hook", false).ok, true);
  });

  it("WEBHOOK_ALLOW_PRIVATE : les IP privées littérales sont acceptées, pas les schémas interdits", () => {
    assert.equal(checkWebhookUrl("http://127.0.0.1:4999/webhook", true).ok, true);
    assert.equal(checkWebhookUrl("ftp://127.0.0.1/hook", true).ok, false);
  });
});

describe("SSRF : lookup à la connexion", () => {
  const resolve = (allowPrivate: boolean, host: string, all = false) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: unknown }>((done) => {
      createSafeLookup(allowPrivate)(host, { all }, (err, address) => done({ err, address }));
    });

  it("refuse un nom qui résout vers une adresse privée (localhost)", async () => {
    const { err } = await resolve(false, "localhost");
    assert.ok(err instanceof SsrfBlockedError);
  });

  it("autorise localhost si allowPrivate, au format simple ou all", async () => {
    const single = await resolve(true, "localhost");
    assert.equal(single.err, null);
    assert.equal(typeof single.address, "string");
    const all = await resolve(true, "localhost", true);
    assert.equal(all.err, null);
    assert.ok(Array.isArray(all.address) && all.address.length > 0);
  });
});
