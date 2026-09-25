import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveNativeLiveMacDaemonConfig,
  stableListenerInstanceId,
} from "../src/domains/bridge/native-live-mac-daemon-config.js";

test("Mac daemon config prefers dedicated Native Live variables", () => {
  const config = resolveNativeLiveMacDaemonConfig({
    LEILEI_NATIVE_LIVE_RELAY_URL: " https://relay.example/ ",
    LEILEI_NATIVE_LIVE_RELAY_TOKEN: " dedicated-token ",
    LEILEI_NATIVE_LIVE_LISTENER_ID:
      "11111111-1111-4111-8111-111111111111",
    MCP_SERVER_URL: "https://fallback.example",
    MCP_AUTH_TOKEN: "fallback-token",
  });

  assert.deepEqual(config, {
    relayBaseUrl: "https://relay.example",
    relayToken: "dedicated-token",
    listenerInstanceId:
      "11111111-1111-4111-8111-111111111111",
    companionBackgroundIntervalMs: 3_600_000,
  });
});

test("Mac daemon config falls back to MCP server URL/token and derives a stable listener id", () => {
  const machine = {
    hostname: () => "Leilei-Mac",
    homedir: () => "/Users/leilei",
  };
  const first = resolveNativeLiveMacDaemonConfig({
    MCP_SERVER_URL: "https://leilei-os.example/",
    MCP_AUTH_TOKEN: "internal-token",
  }, machine);
  const second = resolveNativeLiveMacDaemonConfig({
    MCP_SERVER_URL: "https://leilei-os.example/",
    MCP_AUTH_TOKEN: "internal-token",
  }, machine);

  assert.equal(first.relayBaseUrl, "https://leilei-os.example");
  assert.equal(first.relayToken, "internal-token");
  assert.equal(first.listenerInstanceId, second.listenerInstanceId);
  assert.match(
    first.listenerInstanceId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
});

test("Mac daemon config accepts an explicit companion background cadence", () => {
  const config = resolveNativeLiveMacDaemonConfig({
    MCP_SERVER_URL: "https://leilei-os.example/",
    MCP_AUTH_TOKEN: "internal-token",
    LEILEI_NATIVE_LIVE_COMPANION_BACKGROUND_INTERVAL_SECONDS: "90",
  }, {
    hostname: () => "Leilei-Mac",
    homedir: () => "/Users/leilei",
  });

  assert.equal(config.companionBackgroundIntervalMs, 90_000);

  assert.throws(
    () => resolveNativeLiveMacDaemonConfig({
      MCP_SERVER_URL: "https://leilei-os.example/",
      MCP_AUTH_TOKEN: "internal-token",
      LEILEI_NATIVE_LIVE_COMPANION_BACKGROUND_INTERVAL_SECONDS: "0",
    }, {
      hostname: () => "Leilei-Mac",
      homedir: () => "/Users/leilei",
    }),
    /positive integer/u,
  );
});

test("stable listener id changes across machines", () => {
  assert.notEqual(
    stableListenerInstanceId("mac-a", "/Users/leilei"),
    stableListenerInstanceId("mac-b", "/Users/leilei"),
  );
});

test("Mac daemon config bootstraps production relay from Railway variables when local env is absent", () => {
  const config = resolveNativeLiveMacDaemonConfig(
    {},
    {
      hostname: () => "Leilei-Mac",
      homedir: () => "/Users/leilei",
    },
    () => ({
      MCP_SERVER_URL: "https://railway-production.example",
      MCP_AUTH_TOKEN: "railway-token",
    }),
  );

  assert.equal(
    config.relayBaseUrl,
    "https://railway-production.example",
  );
  assert.equal(config.relayToken, "railway-token");
});

test("Mac daemon config does not invoke Railway loader when local env is complete", () => {
  let calls = 0;
  const config = resolveNativeLiveMacDaemonConfig(
    {
      MCP_SERVER_URL: "https://local.example",
      MCP_AUTH_TOKEN: "local-token",
    },
    {
      hostname: () => "Leilei-Mac",
      homedir: () => "/Users/leilei",
    },
    () => {
      calls += 1;
      return {};
    },
  );
  assert.equal(config.relayToken, "local-token");
  assert.equal(calls, 0);
});

test("Mac daemon config uses the known production URL but fails closed without any relay token", () => {
  assert.throws(
    () => resolveNativeLiveMacDaemonConfig(
      {},
      {
        hostname: () => "Leilei-Mac",
        homedir: () => "/Users/leilei",
      },
      () => ({}),
    ),
    /relay token is required/,
  );
});
