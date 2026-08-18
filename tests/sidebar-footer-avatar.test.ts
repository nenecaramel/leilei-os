import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appShell = readFileSync(
  new URL("../web/src/layout/AppShell.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

test("desktop sidebar footer avatar uses the fixed neutral circle colors", () => {
  assert.match(
    appShell,
    /<div className="sidebar-footer">[\s\S]*?<div className="user-avatar">/,
  );

  const rule = styles.match(/\.user-avatar\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  assert.match(rule, /border:\s*1px solid #d9d9d9;/i);
  assert.match(rule, /background-color:\s*#ebebeb;/i);
  assert.doesNotMatch(rule, /var\(--theme/i);
});

test("mobile navigation still hides the desktop sidebar footer", () => {
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*?\.sidebar-brand,\s*\.sidebar-footer\s*\{\s*display:\s*none;/,
  );
});
