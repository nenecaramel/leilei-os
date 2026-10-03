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


test("Claude Usage uses Context-style placeholder and fail-soft refresh states", () => {
  const usageSheet = readFileSync(
    new URL("../ios/LeileiOS/LeileiOS/Navigation/ClaudeUsageSheet.swift", import.meta.url),
    "utf8",
  );

  assert.match(
    usageSheet,
    /if let snapshot,\s*!snapshot\.windows\.isEmpty/,
  );
  assert.match(
    usageSheet,
    /Text\("Usage"\)[\s\S]*Text\("—"\)[\s\S]*ProgressView\(value: 0\)/,
  );
  assert.match(
    usageSheet,
    /formattedDate\(snapshot\?\.observedAt\)[\s\S]*\?\? "—"/,
  );
  assert.doesNotMatch(
    usageSheet,
    /No usage windows reported yet|No Claude usage snapshot yet/,
  );
  assert.doesNotMatch(usageSheet, /errorMessage/);
  assert.match(
    usageSheet,
    /catch \{[\s\S]*Keep the existing snapshot when refresh[\s\S]*\}/,
  );
});


test("Claude Usage keeps refresh on the left and Done on the right", () => {
  const usageSheet = readFileSync(
    new URL("../ios/LeileiOS/LeileiOS/Navigation/ClaudeUsageSheet.swift", import.meta.url),
    "utf8",
  );

  const refreshIndex = usageSheet.indexOf(
    "ToolbarItem(placement: .cancellationAction)",
  );
  const doneIndex = usageSheet.indexOf(
    "ToolbarItem(placement: .confirmationAction)",
  );
  assert.ok(refreshIndex >= 0);
  assert.ok(doneIndex >= 0);
  assert.ok(refreshIndex < doneIndex);
  assert.match(
    usageSheet,
    /ToolbarItem\(placement: \.cancellationAction\)[\s\S]*Image\(systemName: "arrow\.clockwise"\)/,
  );
  assert.match(
    usageSheet,
    /ToolbarItem\(placement: \.confirmationAction\)[\s\S]*Button\("Done"\)/,
  );
});
