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
test("desktop sidebar omits the account footer and legacy brand mark", () => {
  assert.doesNotMatch(appShell, /className="sidebar-footer"|className="brand-mark"/);
  assert.match(appShell, /<NavigationPanel navClassName="primary-nav" \/>/);
});

test("mobile navigation still hides the desktop sidebar footer", () => {
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*?\.sidebar-brand,\s*\.sidebar-footer\s*\{\s*display:\s*none;/,
  );
});
