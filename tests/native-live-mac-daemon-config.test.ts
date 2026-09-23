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

test("stable listener id changes across machines", () => {
  assert.notEqual(
    stableListenerInstanceId("mac-a", "/Users/leilei"),
    stableListenerInstanceId("mac-b", "/Users/leilei"),
  );
});

test("Mac daemon config still fails closed when neither relay nor MCP auth exists", () => {
  assert.throws(
    () => resolveNativeLiveMacDaemonConfig({}),
    /relay URL is required/,
  );
  assert.throws(
    () => resolveNativeLiveMacDaemonConfig({
      MCP_SERVER_URL: "https://leilei-os.example",
    }),
    /relay token is required/,
  );
});
