import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageContainer = readFileSync(
  new URL("../ios/LeileiOS/LeileiOS/Navigation/PageContainer.swift", import.meta.url),
  "utf8",
);
const apiClient = readFileSync(
  new URL("../ios/LeileiOS/LeileiOS/Infrastructure/API/System/SystemAPI.swift", import.meta.url),
  "utf8",
);

test("Chat conversation menu exposes Claude Usage without occupying the toolbar", () => {
  assert.match(pageContainer, /Label\("Claude Usage", systemImage:/);
  assert.match(pageContainer, /showingClaudeUsage\s*=\s*true/);
  assert.match(pageContainer, /\.sheet\(isPresented:\s*\$showingClaudeUsage\)/);
});

test("iOS reads Claude account usage from the authenticated system endpoint", () => {
  assert.match(apiClient, /func systemClaudeUsage\(\) async throws -> SystemClaudeUsageSnapshot/);
  assert.match(apiClient, /path:\s*"\/api\/v1\/system\/claude-usage"/);
});
