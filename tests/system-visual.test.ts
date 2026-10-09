import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

const marker =
  "/* System pages: Leilei OS shared visual language */";
const systemBlock =
  styles.split(marker)[1] ?? "";

test("System page geometry matches the accepted mobile content width and heading scale", () => {
  assert.ok(systemBlock);
  assert.match(
    systemBlock,
    /\.system-page\s*\{[\s\S]*?width:\s*min\(860px,\s*calc\(100%\s*-\s*48px\)\)/,
  );
  assert.match(
    systemBlock,
    /\.system-page\s*\{[\s\S]*?padding:\s*18px 0/,
  );
  assert.match(
    systemBlock,
    /\.system-page \.page-header h1\s*\{[\s\S]*?font-size:\s*18px/,
  );
  assert.match(
    systemBlock,
    /\.system-page \.page-header h1\s*\{[\s\S]*?font-weight:\s*500/,
  );
  assert.match(
    systemBlock,
    /\.system-page \.page-header > div > p:last-child\s*\{[\s\S]*?font-size:\s*12px/,
  );
});

test("all ordinary System information rows share the accepted 60px baseline", () => {
  assert.match(
    systemBlock,
    /\.system-detail-row,[\s\S]*?\.system-status-row,[\s\S]*?\.system-data-row\s*\{[\s\S]*?min-height:\s*60px/,
  );
  assert.match(
    systemBlock,
    /\.system-product-name\s*\{[\s\S]*?min-height:\s*60px/,
  );
});

test("ordinary primary labels use the accepted 14px 500 hierarchy while secondary text stays 12px", () => {
  assert.match(
    systemBlock,
    /\.system-detail-row dt,[\s\S]*?\.system-status-row > span,[\s\S]*?\.system-data-row > strong\s*\{[\s\S]*?font-size:\s*14px[\s\S]*?font-weight:\s*500/,
  );
  assert.match(
    systemBlock,
    /\.system-status-row > strong\s*\{[\s\S]*?font-size:\s*12px/,
  );
});

test("System cards keep inset separators instead of edge-to-edge rules", () => {
  assert.match(
    systemBlock,
    /\.system-section\s*\{[\s\S]*?padding:\s*0 13px/,
  );
  assert.match(
    systemBlock,
    /\.system-detail-row \+ \.system-detail-row,[\s\S]*?\.system-status-row \+ \.system-status-row,[\s\S]*?\.system-data-row \+ \.system-data-row\s*\{[\s\S]*?border-top:\s*1px solid rgba\(0,\s*0,\s*0,\s*0\.08\)/,
  );
  const ordinaryRowsRule =
    systemBlock.match(
      /\.system-detail-row,\s*\.system-status-row,\s*\.system-data-row\s*\{[^}]*\}/,
    )?.[0] ?? "";

  assert.match(
    ordinaryRowsRule,
    /border:\s*0/,
  );
  assert.doesNotMatch(
    ordinaryRowsRule,
    /border-bottom:/,
  );
});

test("System cards retain the accepted light paper surface values", () => {
  assert.match(
    systemBlock,
    /\.system-section\s*\{[\s\S]*?border:\s*1px solid rgba\(0,\s*0,\s*0,\s*0\.11\)/,
  );
  assert.match(
    systemBlock,
    /\.system-section\s*\{[\s\S]*?border-radius:\s*14px/,
  );
  assert.match(
    systemBlock,
    /\.system-section\s*\{[\s\S]*?box-shadow:\s*0 10px 28px rgba\(0,\s*0,\s*0,\s*0\.055\)/,
  );
});

test("mobile System does not narrow the accepted 48px total page gutter", () => {
  const mobileBlock =
    systemBlock.split(
      "@media (max-width: 640px)",
    )[1] ?? "";

  assert.ok(mobileBlock);
  assert.doesNotMatch(
    mobileBlock,
    /\.system-page\s*\{[\s\S]*?width:\s*calc\(100%\s*-\s*32px\)/,
  );
  assert.doesNotMatch(
    mobileBlock,
    /\.system-page\s*\{[\s\S]*?width:\s*calc\(100%\s*-\s*28px\)/,
  );
});
