import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("only standalone PWA persists Auth0 cache and enables refresh tokens", async () => {
  const source = await readFile(
    "web/src/auth/AuthProvider.tsx",
    "utf8",
  );

  assert.match(
    source,
    /isStandaloneWebApp/,
  );
  assert.match(
    source,
    /const standalone = isStandaloneWebApp\(\)/,
  );
  assert.match(
    source,
    /cacheLocation=\{standalone \? "localstorage" : "memory"\}/,
  );
  assert.match(
    source,
    /useRefreshTokens=\{standalone\}/,
  );
  assert.doesNotMatch(
    source,
    /cacheLocation="localstorage"/,
    "localStorage must not be enabled unconditionally for normal browser sessions",
  );
});
