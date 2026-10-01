import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const apiClient = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/Infrastructure/LeileiAPIClient.swift",
  "utf8",
);

test("iOS exposes Claude Sonnet 5.5 with provider-native thinking constraints", () => {
  assert.match(
    apiClient,
    /case sonnet55 = "claude-sonnet-5-5"/,
  );
  assert.match(
    apiClient,
    /case \.sonnet55:\s*return "Sonnet 5\.5"/,
  );
  assert.match(
    apiClient,
    /case \.sonnet55:\s*return \[\.adaptive, \.betweenTools\]/,
  );
  assert.match(
    apiClient,
    /case \.sonnet55:\s*return thinking == \.betweenTools\s*\? \[\.low, \.medium, \.high\]\s*: \[\.low, \.medium, \.high, \.xhigh, \.max\]/,
  );
  assert.match(
    apiClient,
    /case betweenTools = "between_tools"/,
  );
});
