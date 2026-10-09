import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extractNativeMobileDesktopCss, mirrorNativeMobilePageCss } from "../web/build/native-mobile-css-transform";
import { extractNativeMobileDesktopCss as publicExtract, nativeMobilePageCssPlugin } from "../web/build/native-mobile-page-css";

// Seven layers retain the main d5687a6a baseline. styles.css is refreshed for the
// authorized header-anchored date menu. Paper date selectors retain their original styles.
const acceptedOutputs = [
  ["styles.css", "95bfa2045b03a3d60b8442b564884632acd09799a6585e6258db8bbec3a73157"],
  ["pages/lg-author-editor-layout-fix.css", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["pages/universe/universe-node-detail-memory-shell.css", "07e2188c297e7f50d118ad1ecee14325190620e4100509944d34063368a6c9ae"],
  ["pages/universe-detail-dayspace-header-polish.css", "09e045be992b2b377cc03bb3a9cb262f3ba53d95113354eaa0a11c3e6e4aaf69"],
  ["pages/universe-mobile-final-geometry.css", "32f9dbdb6d79c3b28bdea2b30ddfa00e54e9e540319df5185b2977ec5755d4fd"],
  ["pages/universe-home-dark.css", "60fd60ed9bded2aeda7535ef212c0d16af529d936a42e83f15b9ce3d6ca8d680"],
  ["pages/universe-home-dark-production-fixes.css", "63e213c0359f08d803f33bb486c7184eff53bdc9669ce0a4c31fd3789e44e3ee"],
  ["pages/universe-state-polish.css", "a918fcf602f1927ca8253f243b671537d33de8743673e16a40c949fe2590c3c1"],
];

test("all eight accepted desktop layers remain byte-for-byte identical", () => {
  const main = readFileSync(new URL("../web/src/main.tsx", import.meta.url), "utf8");
  const imports = [...main.matchAll(/import "\.\/([^"?]+\.css)\?native-mobile-desktop"/g)].map((match) => match[1]);
  assert.deepEqual(imports, acceptedOutputs.map(([path]) => path));
  for (const [path, expected] of acceptedOutputs) {
    const source = readFileSync(new URL(`../web/src/${path}`, import.meta.url), "utf8");
    assert.equal(createHash("sha256").update(extractNativeMobileDesktopCss(source)).digest("hex"), expected, path);
  }
});

test("public adapter keeps the same transform function and plugin filtering", () => {
  assert.equal(publicExtract, extractNativeMobileDesktopCss);
  const plugin = nativeMobilePageCssPlugin();
  const transform = plugin.transform as (code: string, id: string) => { code: string; map: null } | null;
  const source = "@media (max-width: 760px) {.diary-row {color:red}}";
  for (const id of ["/web/src/styles.css?native-mobile-desktop", "/web/src/styles.css?raw&native-mobile-desktop"]) {
    assert.deepEqual(transform(source, id), { code: extractNativeMobileDesktopCss(source), map: null });
  }
  for (const id of ["/web/src/styles.css", "/elsewhere/styles.css?native-mobile-desktop", "/web/src/a.ts?native-mobile-desktop"]) {
    assert.equal(transform(source, id), null);
  }
});

test("nested rules, quoted braces and selector commas retain their projection", () => {
  const source = `@media (max-width: 760px) {
    /* ignored { } */
    @supports (display: grid) {
      .diary-row:is(.a,.b), .universe-node[data-label="a,b"] {content: "}";}
      .unrelated {color:red}
    }
    .paper-detail-title {color:blue}
    @keyframes spin {from {opacity:0} to {opacity:1}}
  }`;
  const actual = extractNativeMobileDesktopCss(source);
  assert.ok(actual.includes('.diary-row:is(.a,.b),\n.universe-node[data-label="a,b"] {content: "}";}'));
  assert.ok(actual.includes("@supports (display: grid)"));
  assert.ok(actual.includes("body:has(:is(.memory-page, .day-space-page, .global-search-page, .universe-page)) .paper-detail-title"));
  assert.ok(!actual.includes(".unrelated"));
  assert.ok(!actual.includes("@keyframes"));
});

test("unmatched and malformed inputs keep empty-result and error behavior", () => {
  for (const source of ["", ".diary-row {color:red}", "@media (max-width:760px) {.unrelated {color:red}}"] ) {
    assert.equal(extractNativeMobileDesktopCss(source), "");
    assert.equal(mirrorNativeMobilePageCss(source), source);
  }
  assert.throws(() => extractNativeMobileDesktopCss("@media (max-width:760px) {.diary-row {"), /Unbalanced CSS block/);
});

test("mirror preserves the original bytes and appends exactly one derived layer", () => {
  const source = "@media (max-width:760px) {.diary-row {padding:3px}}";
  assert.equal(mirrorNativeMobilePageCss(source), `${source}\n\n${extractNativeMobileDesktopCss(source)}`);
});
