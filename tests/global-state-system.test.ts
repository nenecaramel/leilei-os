import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stateSource = readFileSync(new URL("../web/src/components/StateSurface.tsx", import.meta.url), "utf8");
const moduleSource = readFileSync(new URL("../web/src/components/ModuleSearch.tsx", import.meta.url), "utf8");
const universeSource = readFileSync(new URL("../web/src/pages/UniversePage.tsx", import.meta.url), "utf8");
const daySpaceSource = readFileSync(new URL("../web/src/pages/DaySpacePage.tsx", import.meta.url), "utf8");
const quickSearchSource = readFileSync(new URL("../web/src/layout/QuickSearchPanel.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

test("global state primitives expose page module paper and transient surfaces", () => {
  assert.match(stateSource, /export function PageState/);
  assert.match(stateSource, /export function ModuleState/);
  assert.match(stateSource, /export function PaperState/);
  assert.match(stateSource, /export function TransientState/);
  assert.match(moduleSource, /<StateSurface/);
});

test("global state typography and geometry use one explicit visual contract", () => {
  assert.match(styles, /--state-font:\s*-apple-system,[\s\S]*?"PingFang SC"/);
  assert.match(styles, /\.state-surface__message\s*\{[^}]*font-size:\s*13px[^}]*font-weight:\s*400/s);
  assert.match(styles, /\.state-surface__description\s*\{[^}]*font-size:\s*12px[^}]*font-weight:\s*400/s);
  assert.match(styles, /\.state-surface__action,[\s\S]*?font-size:\s*11px[\s\S]*?font-weight:\s*500/s);
  assert.match(styles, /\.state-surface--module\s*\{[^}]*margin:\s*64px auto 0/s);
  assert.match(styles, /\.state-surface--paper\s*\{[^}]*margin:\s*96px auto 0/s);
  assert.match(styles, /\.state-surface--page\s*\{[^}]*place-content:\s*center/s);
});

test("major custom surfaces now participate in the shared state system", () => {
  assert.match(universeSource, /<PageState[\s\S]*message="Reading\.\.\."/);
  assert.match(daySpaceSource, /<ModuleState state="loading" message="Reading\.\.\."/);
  assert.match(quickSearchSource, /<StateSurface[\s\S]*message="Unable to read search results\."[\s\S]*onRetry=/);
});

test("legacy compact surfaces inherit the same state hierarchy", () => {
  assert.match(styles, /\.home-module-state\s*\{[^}]*font-size:\s*12px[^}]*font-weight:\s*400/s);
  assert.match(styles, /\.quick-search-state \.state-surface__message\s*\{[^}]*font-size:\s*12px[^}]*font-weight:\s*400/s);
  assert.match(styles, /\.system-state-message \.secondary-button\s*\{[^}]*font-size:\s*11px[^}]*font-weight:\s*500/s);
  assert.match(styles, /\.memory-action-notice,[\s\S]*?\.transient-state--error\s*\{[^}]*font-size:\s*12px[^}]*font-weight:\s*400/s);
});
