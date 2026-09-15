import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mapSource = readFileSync(
  new URL("../web/src/pages/universe/UniverseMobileMap.tsx", import.meta.url),
  "utf8",
);

test("Universe resolves its initial viewport before the first paint", () => {
  assert.match(
    mapSource,
    /useLayoutEffect\(\(\) => \{\s*if \(didFit\.current\) return;\s*if \(isDesktopViewport\(\) && !hasMeasuredMapSize\) return;/s,
  );
  assert.doesNotMatch(
    mapSource,
    /useEffect\(\(\) => \{\s*if \(didFit\.current\) return;\s*if \(isDesktopViewport\(\) && !hasMeasuredMapSize\) return;/s,
  );
});
