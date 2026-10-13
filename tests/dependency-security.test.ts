import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// Exercise the actual proxy-addr used by Express, rather than asserting a lockfile version.
const require = createRequire(import.meta.url);
const expressRequire = createRequire(require.resolve("express"));
const proxyAddr = expressRequire("proxy-addr") as {
  compile(subnets: string | string[]): (address: string, index: number) => boolean;
};

test("proxy trust cannot turn a short IPv4-mapped IPv6 prefix into trust for every IPv4 peer", () => {
  const trust = proxyAddr.compile("::ffff:10.0.0.0/8");
  assert.equal(trust("203.0.113.1", 0), false);
  assert.equal(trust("192.0.2.1", 0), false);
});

test("proxy trust preserves correctly configured IPv4 and mapped IPv6 subnet membership", () => {
  for (const subnet of ["10.0.0.0/8", "::ffff:10.0.0.0/104"]) {
    const trust = proxyAddr.compile(subnet);
    assert.equal(trust("10.1.2.3", 0), true);
    assert.equal(trust("::ffff:10.1.2.3", 0), true);
    assert.equal(trust("203.0.113.1", 0), false);
  }
});
