import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveNativeLiveMacBaseWorkspaceRoot,
  resolveNativeLiveMacDaemonConfig,
  resolveNativeLiveMacWorkspaceRoots,
  stableListenerInstanceId,
} from "../src/domains/bridge/native-live-mac-daemon-config.js";

const fakeFilesystem = {
  realpath: (path: string) => path,
  isDirectory: (_path: string) => true,
};

test("Mac daemon config prefers dedicated Native Live variables", () => {
  const root = process.cwd();
  const config = resolveNativeLiveMacDaemonConfig({
    LEILEI_NATIVE_LIVE_RELAY_URL: " https://relay.example/ ",
    LEILEI_NATIVE_LIVE_RELAY_TOKEN: " dedicated-token ",
    LEILEI_NATIVE_LIVE_LISTENER_ID:
      "11111111-1111-4111-8111-111111111111",
    LEILEI_NATIVE_LIVE_WORKSPACE_ROOT: root,
    MCP_SERVER_URL: "https://fallback.example",
    MCP_AUTH_TOKEN: "fallback-token",
  });

  assert.deepEqual(config, {
    relayBaseUrl: "https://relay.example",
    relayToken: "dedicated-token",
    listenerInstanceId:
      "11111111-1111-4111-8111-111111111111",
    companionBackgroundIntervalMs: 3_600_000,
    baseWorkspaceRoot: root,
    workspaceRoots: {},
  });
});

test("Mac daemon config uses a dedicated relay token and derives a stable listener id", () => {
  const machine = {
    hostname: () => "Leilei-Mac",
    homedir: () => "/Users/leilei",
  };
  const first = resolveNativeLiveMacDaemonConfig(
    {
      MCP_SERVER_URL: "https://leilei-os.example/",
    },
    machine,
    () => ({
      NATIVE_LIVE_RELAY_AUTH_TOKEN:
        "relay-token-that-is-long-enough-for-production",
    }),
    fakeFilesystem,
  );
  const second = resolveNativeLiveMacDaemonConfig(
    {
      MCP_SERVER_URL: "https://leilei-os.example/",
    },
    machine,
    () => ({
      NATIVE_LIVE_RELAY_AUTH_TOKEN:
        "relay-token-that-is-long-enough-for-production",
    }),
    fakeFilesystem,
  );

  assert.equal(first.relayBaseUrl, "https://leilei-os.example");
  assert.equal(
    first.relayToken,
    "relay-token-that-is-long-enough-for-production",
  );
  assert.equal(first.listenerInstanceId, second.listenerInstanceId);
  assert.equal(first.baseWorkspaceRoot, "/Users/leilei");
  assert.match(
    first.listenerInstanceId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
});

test("Mac daemon base workspace root defaults to canonical home and ignores process cwd", () => {
  const root = resolveNativeLiveMacBaseWorkspaceRoot(
    {},
    { homedir: () => "/Users/leilei" },
    {
      realpath: (path) =>
        path === "/Users/leilei"
          ? "/System/Volumes/Data/Users/leilei"
          : path,
      isDirectory: () => true,
    },
  );
  assert.equal(root, "/System/Volumes/Data/Users/leilei");
});

test("Mac daemon base workspace root prefers an explicit canonical directory", () => {
  const root = resolveNativeLiveMacBaseWorkspaceRoot(
    {
      LEILEI_NATIVE_LIVE_WORKSPACE_ROOT:
        " /Users/leilei/Projects/leileios ",
    },
    { homedir: () => "/Users/leilei" },
    {
      realpath: () => "/Volumes/work/leileios",
      isDirectory: () => true,
    },
  );
  assert.equal(root, "/Volumes/work/leileios");
});

test("Mac daemon workspace map canonicalizes durable Workspace ids to local realpaths", () => {
  const workspaceId = "55555555-5555-4555-8555-555555555555";
  const roots = resolveNativeLiveMacWorkspaceRoots(
    {
      LEILEI_NATIVE_LIVE_WORKSPACE_MAP_JSON: JSON.stringify({
        [workspaceId]: "/Users/leilei/Projects/demo",
      }),
    },
    {
      realpath: (path) =>
        path === "/Users/leilei/Projects/demo"
          ? "/System/Volumes/Data/Users/leilei/Projects/demo"
          : path,
      isDirectory: () => true,
    },
  );

  assert.deepEqual(roots, {
    [workspaceId]:
      "/System/Volumes/Data/Users/leilei/Projects/demo",
  });
});

test("Mac daemon workspace map fails closed for invalid ids and roots", () => {
  assert.throws(
    () => resolveNativeLiveMacWorkspaceRoots(
      {
        LEILEI_NATIVE_LIVE_WORKSPACE_MAP_JSON:
          JSON.stringify({ not-a-uuid: "/tmp/demo" }),
      },
      fakeFilesystem,
    ),
    /Workspace UUIDs/u,
  );
  assert.throws(
    () => resolveNativeLiveMacWorkspaceRoots(
      {
        LEILEI_NATIVE_LIVE_WORKSPACE_MAP_JSON: JSON.stringify({
          "55555555-5555-4555-8555-555555555555": "./demo",
        }),
      },
      fakeFilesystem,
    ),
    /absolute paths/u,
  );
});

test("Mac daemon base workspace root rejects relative, missing, and non-directory targets", () => {
  assert.throws(
    () => resolveNativeLiveMacBaseWorkspaceRoot(
      { LEILEI_NATIVE_LIVE_WORKSPACE_ROOT: "./leileios" },
      { homedir: () => "/Users/leilei" },
      fakeFilesystem,
    ),
    /absolute path/u,
  );

  assert.throws(
    () => resolveNativeLiveMacBaseWorkspaceRoot(
      { LEILEI_NATIVE_LIVE_WORKSPACE_ROOT: "/missing" },
      { homedir: () => "/Users/leilei" },
      {
        realpath: () => {
          throw new Error("ENOENT");
        },
        isDirectory: () => true,
      },
    ),
    /existing directory/u,
  );

  assert.throws(
    () => resolveNativeLiveMacBaseWorkspaceRoot(
      { LEILEI_NATIVE_LIVE_WORKSPACE_ROOT: "/tmp/file" },
      { homedir: () => "/Users/leilei" },
      {
        realpath: (path) => path,
        isDirectory: () => false,
      },
    ),
    /existing directory/u,
  );
});

test("Mac daemon config accepts an explicit companion background cadence", () => {
  const config = resolveNativeLiveMacDaemonConfig({
    MCP_SERVER_URL: "https://leilei-os.example/",
    LEILEI_NATIVE_LIVE_RELAY_TOKEN:
      "relay-token-that-is-long-enough-for-production",
    LEILEI_NATIVE_LIVE_COMPANION_BACKGROUND_INTERVAL_SECONDS: "90",
  }, {
    hostname: () => "Leilei-Mac",
    homedir: () => "/Users/leilei",
  }, () => ({}), fakeFilesystem);

  assert.equal(config.companionBackgroundIntervalMs, 90_000);

  assert.throws(
    () => resolveNativeLiveMacDaemonConfig({
      MCP_SERVER_URL: "https://leilei-os.example/",
      LEILEI_NATIVE_LIVE_RELAY_TOKEN:
        "relay-token-that-is-long-enough-for-production",
      LEILEI_NATIVE_LIVE_COMPANION_BACKGROUND_INTERVAL_SECONDS: "0",
    }, {
      hostname: () => "Leilei-Mac",
      homedir: () => "/Users/leilei",
    }, () => ({}), fakeFilesystem),
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
      NATIVE_LIVE_RELAY_AUTH_TOKEN:
        "railway-relay-token-that-is-long-enough",
    }),
    fakeFilesystem,
  );

  assert.equal(
    config.relayBaseUrl,
    "https://railway-production.example",
  );
  assert.equal(
    config.relayToken,
    "railway-relay-token-that-is-long-enough",
  );
});

test("Mac daemon config does not invoke Railway loader when local env is complete", () => {
  let calls = 0;
  const config = resolveNativeLiveMacDaemonConfig(
    {
      MCP_SERVER_URL: "https://local.example",
      LEILEI_NATIVE_LIVE_RELAY_TOKEN:
        "local-relay-token-that-is-long-enough",
    },
    {
      hostname: () => "Leilei-Mac",
      homedir: () => "/Users/leilei",
    },
    () => {
      calls += 1;
      return {};
    },
    fakeFilesystem,
  );
  assert.equal(
    config.relayToken,
    "local-relay-token-that-is-long-enough",
  );
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
      fakeFilesystem,
    ),
    /relay token is required/,
  );
});

test("Mac daemon never falls back to the broad internal MCP credential", () => {
  assert.throws(
    () => resolveNativeLiveMacDaemonConfig(
      {
        MCP_SERVER_URL: "https://leilei-os.example/",
        MCP_AUTH_TOKEN: "broad-internal-token",
      },
      {
        hostname: () => "Leilei-Mac",
        homedir: () => "/Users/leilei",
      },
      () => ({}),
      fakeFilesystem,
    ),
    /relay token is required/,
  );
});
