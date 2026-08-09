import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

const systemMarker =
  "/* System pages: Leilei OS shared visual language */";
const systemBlock =
  styles.split(systemMarker)[1] ?? "";

test("System heading structure matches the accepted Memory Diary mobile heading geometry", () => {
  assert.match(
    systemBlock,
    /\.system-page \.page-header\s*\{[^}]*position:\s*relative[^}]*display:\s*grid[^}]*margin:\s*0[^}]*padding:\s*0 0 10px/,
  );

  assert.match(
    systemBlock,
    /\.system-page \.page-header > div\s*\{[^}]*min-width:\s*0[^}]*padding-top:\s*2px/,
  );

  assert.match(
    systemBlock,
    /\.system-page \.page-header h1\s*\{[^}]*font-size:\s*18px[^}]*font-weight:\s*500[^}]*letter-spacing:\s*-0\.03em[^}]*line-height:\s*1\.2/,
  );

  assert.match(
    systemBlock,
    /\.system-page \.page-header > div > p:last-child\s*\{[^}]*margin:\s*3px 0 0[^}]*color:\s*#8a8a8a[^}]*font-size:\s*12px[^}]*line-height:\s*1\.3/,
  );
});

test("mobile drawer keeps a 40px tap row but draws a 36px inset selection tile", () => {
  const marker =
    "/* Mobile drawer active-tile polish */";
  const drawerBlock =
    styles.split(marker)[1] ?? "";

  assert.ok(drawerBlock);

  assert.match(
    drawerBlock,
    /\.mobile-drawer \.nav-item\s*\{[^}]*position:\s*relative[^}]*height:\s*40px[^}]*min-height:\s*40px/,
  );

  assert.match(
    drawerBlock,
    /\.mobile-drawer \.nav-item::before\s*\{[^}]*inset:\s*2px 0[^}]*border-radius:\s*9px/,
  );

  assert.match(
    drawerBlock,
    /\.mobile-drawer \.nav-item\.active\s*\{[^}]*background:\s*transparent/,
  );

  assert.match(
    drawerBlock,
    /\.mobile-drawer \.nav-item\.active::before\s*\{[^}]*background:\s*#eeeeee/,
  );
});
