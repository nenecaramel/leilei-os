import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import * as protocol from "../src/domains/bridge/protocol/native-live-runtime-protocol.js";

test("runtime protocol facade retains its exact runtime export surface", () => {
  assert.deepEqual(Object.keys(protocol).sort(), [
  "NATIVE_LIVE_RUNTIME_ATTACHMENT_PROTOCOL_VERSION",
  "NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION",
  "NativeLiveRuntimeProtocolError",
  "assertRuntimeResultMatchesCommand",
  "parseNativeLiveRuntimeCommand",
  "parseNativeLiveRuntimeEnvironment",
  "parseNativeLiveRuntimeExecutionResult",
  "parseNativeLiveRuntimeOutputResources",
  "parseNativeLiveRuntimeResultTelemetry",
  "parseNativeLiveRuntimeSessionStoreHealth",
  "parseNativeLiveRuntimeVcsChanges"
]);
  assert.equal(protocol.NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION, 4);
  assert.equal(protocol.NATIVE_LIVE_RUNTIME_ATTACHMENT_PROTOCOL_VERSION, 2);
});

test("runtime protocol parsing has focused boundaries behind the compatibility facade", () => {
  for (const [file, symbol] of [
    ["types", "NativeLiveRuntimeCommand"], ["command", "parseNativeLiveRuntimeCommand"],
    ["result", "parseNativeLiveRuntimeExecutionResult"], ["environment", "parseNativeLiveRuntimeEnvironment"],
    ["telemetry", "parseNativeLiveRuntimeResultTelemetry"], ["resources", "parseNativeLiveRuntimeOutputResources"],
    ["session-store", "parseNativeLiveRuntimeSessionStoreHealth"], ["vcs", "parseNativeLiveRuntimeVcsChanges"],
    ["parsing", "NativeLiveRuntimeProtocolError"],
  ]) {
    const path = `src/domains/bridge/protocol/runtime-protocol/${file}.ts`;
    assert.ok(fs.existsSync(path), `missing ${path}`);
    assert.match(fs.readFileSync(path, "utf8"), new RegExp(`export (?:type|function|class) ${symbol}\\b`));
  }
  const facade = fs.readFileSync("src/domains/bridge/protocol/native-live-runtime-protocol.ts", "utf8");
  assert.doesNotMatch(facade, /export function|export class|throw new/);
});
