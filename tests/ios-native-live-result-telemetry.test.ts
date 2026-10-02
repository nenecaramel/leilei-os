import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const apiClient = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/Infrastructure/LeileiAPIClient.swift",
  "utf8",
);

test("iOS decodes durable Native Live result telemetry", () => {
  assert.match(
    apiClient,
    /struct NativeLiveRuntimeMetadata:[\s\S]*let result: NativeLiveRuntimeResultTelemetry\?/,
  );
  assert.match(
    apiClient,
    /struct NativeLiveRuntimeResultTelemetry:[\s\S]*let terminalReason: String\?[\s\S]*let modelUsage: \[String: NativeLiveJSONValue\]\?[\s\S]*let permissionDenials:/,
  );
  assert.match(
    apiClient,
    /case terminalReason = "terminal_reason"/,
  );
  assert.match(
    apiClient,
    /case durationApiMs = "duration_api_ms"/,
  );
  assert.match(
    apiClient,
    /case queuedTurnCount = "queued_turn_count"/,
  );
  assert.match(
    apiClient,
    /case firstStreamPostQueueWaitMs =[\s\S]*"first_stream_post_queue_wait_ms"/,
  );
});
