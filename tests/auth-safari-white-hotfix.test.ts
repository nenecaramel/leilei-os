import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("auth surfaces force Safari browser chrome and document roots to pure white", async () => {
  const [source, css] = await Promise.all([
    readFile("web/src/auth/ProtectedApp.tsx", "utf8"),
    readFile("web/src/styles.css", "utf8"),
  ]);

  assert.match(source, /syncThemeColorMeta/);
  assert.match(
    source,
    /authSurfaceVisible\s*=\s*isLoading\s*\|\|\s*Boolean\(error\)\s*\|\|\s*!isAuthenticated/,
  );
  assert.match(
    source,
    /classList\.add\("auth-surface-active"\)/,
  );
  assert.match(
    source,
    /syncThemeColorMeta\(document,\s*"#ffffff"\)/,
  );
  assert.match(source, /previousThemeColor/);
  assert.match(
    source,
    /classList\.remove\("auth-surface-active"\)/,
  );

  assert.match(css, /auth-safari-white-hotfix-2026-08-09:start/);
  assert.match(
    css,
    /html\.auth-surface-active,[\s\S]*?html\.auth-surface-active body,[\s\S]*?html\.auth-surface-active #root[\s\S]*?background:\s*#fff\s*!important/,
  );
  assert.match(
    css,
    /html\.auth-surface-active body[\s\S]*?background-image:\s*none\s*!important/,
  );
});

test("Auth0 text action never paints a tap, focus, or active box", async () => {
  const css = await readFile("web/src/styles.css", "utf8");

  assert.match(
    css,
    /\.auth-text-action,[\s\S]*?\.auth-text-action:focus-visible[\s\S]*?background:\s*transparent\s*!important/,
  );
  assert.match(
    css,
    /\.auth-text-action,[\s\S]*?\.auth-text-action:focus-visible[\s\S]*?box-shadow:\s*none\s*!important/,
  );
  assert.match(
    css,
    /\.auth-text-action,[\s\S]*?\.auth-text-action:focus-visible[\s\S]*?outline:\s*none\s*!important/,
  );
  assert.match(
    css,
    /-webkit-tap-highlight-color:\s*transparent\s*!important/,
  );
});

test("auth login composition matches the screenshot-approved vertical position", async () => {
  const css = await readFile("web/src/styles.css", "utf8");
  assert.match(
    css,
    /\.auth-minimal\s*\{[\s\S]*?transform:\s*translateY\(68px\)/,
  );
});
