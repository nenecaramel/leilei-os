import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../web/src/pages/UniversePage.tsx", import.meta.url),
  "utf8",
) + readFileSync(new URL("../web/src/pages/universe/UniversePagePresentation.tsx", import.meta.url), "utf8");
const stateCss = readFileSync(
  new URL("../web/src/pages/universe-state-polish.css", import.meta.url),
  "utf8",
);

test("Universe loading and empty states are plain centered text on white", () => {
  assert.match(pageSource, /<PageState[\s\S]*?state="loading"[\s\S]*?message="Reading\.\.\."/);
  assert.match(pageSource, /UniverseImportFlow/);

  assert.match(
    stateCss,
    /\.universe-page:has\(\.universe-cosmos-loading\)[\s\S]*display:\s*flex\s*!important/,
  );
  assert.match(
    stateCss,
    /\.universe-page:has\(\.universe-import-flow\)[\s\S]*display:\s*flex\s*!important/,
  );
  assert.match(
    stateCss,
    /\.universe-page \.universe-cosmos\.universe-cosmos-loading[\s\S]*place-items:\s*center\s*!important/,
  );
  assert.match(
    stateCss,
    /\.universe-page \.universe-cosmos\.universe-cosmos-loading[\s\S]*border:\s*0\s*!important/,
  );
  assert.match(
    stateCss,
    /\.universe-import-flow\s*\{[\s\S]*flex:\s*1 1 auto[\s\S]*align-content:\s*center/,
  );
  assert.match(
    stateCss,
    /\.universe-page \.universe-loading-line,[\s\S]*color:\s*#8d8d8d\s*!important/,
  );
  assert.match(
    stateCss,
    /\.universe-page \.universe-loading-dots\s*\{[\s\S]*display:\s*none\s*!important/,
  );
  const loadingStart = pageSource.indexOf('if (state.status === "loading")');
  const emptyStart = pageSource.indexOf('if (state.status === "not-initialized")');
  assert.ok(loadingStart >= 0 && emptyStart > loadingStart);
  assert.doesNotMatch(pageSource.slice(loadingStart, emptyStart), /UniverseImportFlow/);
});
