import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const polishCss = readFileSync(
  new URL("../web/src/pages/universe-detail-dayspace-header-polish.css", import.meta.url),
  "utf8",
);
const homeCss = readFileSync(
  new URL("../web/src/pages/universe/universe-home-polish.css", import.meta.url),
  "utf8",
);

test("export popover clears the legacy 36px content height and matches placement vertical typography", () => {
  assert.match(homeCss, /--universe-home-popover-content-height:\s*36px/);
  assert.match(polishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-overflow-menu button\s*\{[^}]*height:\s*auto !important;[^}]*min-height:\s*0 !important;[^}]*padding:\s*6px 8px !important;[^}]*font-size:\s*13px !important;[^}]*line-height:\s*1\.35 !important;/s);
  assert.match(polishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-placement-popover > span\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*0;[^}]*padding:\s*6px 8px;/s);
});

test("detail create edit and connection bottom actions share one visual baseline contract", () => {
  assert.match(polishCss, /\.universe-standalone-detail,[\s\S]*?\.universe-standalone-editor,[\s\S]*?\.universe-standalone-connection\s*\{[^}]*padding-bottom:\s*14px !important;/s);
  assert.match(polishCss, /\.universe-standalone-detail-actions button,[\s\S]*?\.universe-standalone-editor-footer button,[\s\S]*?\.universe-standalone-connection-footer button[\s\S]*?\{[^}]*color:\s*#7d7f8c !important;[^}]*font-size:\s*12px !important;[^}]*font-weight:\s*400 !important;[^}]*line-height:\s*1\.35 !important;/s);
});
