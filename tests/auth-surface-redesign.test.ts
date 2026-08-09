import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Auth surfaces use the minimal pure-white Leilei OS composition", async () => {
  const [source, css] = await Promise.all([
    readFile("web/src/auth/ProtectedApp.tsx", "utf8"),
    readFile("web/src/styles.css", "utf8"),
  ]);

  assert.doesNotMatch(source, /Personal operations, quietly organized/);
  assert.doesNotMatch(source, /欢迎回到 Leilei OS/);
  assert.doesNotMatch(source, /className="brand-mark"/);
  assert.doesNotMatch(source, /className="auth-card"/);
  assert.match(source, /<h1>Leilei OS<\/h1>/);
  assert.match(source, />\s*使用 Auth0 登录\s*</);
  assert.match(source, /loading-orb/);
  assert.match(source, /auth-screen-loading/);
  assert.match(source, /auth-minimal-error/);

  const redirectCalls = source.match(/loginWithRedirect\(\)/g) ?? [];
  assert.ok(redirectCalls.length >= 2, "login and retry must both keep Auth0 redirect");

  assert.match(css, /auth-surface-redesign-2026-08-09:start/);
  assert.match(css, /\.auth-screen\s*\{[\s\S]*?background:\s*#fff\s*!important/i);
  assert.match(css, /\.auth-text-action:focus-visible/);
});


test("auth title keeps the screenshot-approved composition offset", async () => {
  const css = await readFile("web/src/styles.css", "utf8");
  assert.match(
    css,
    /\.auth-minimal\s*\{[\s\S]*?transform:\s*translateY\(68px\)/,
  );
  assert.match(
    css,
    /\.auth-minimal h1\s*\{[\s\S]*?font-size:\s*29px/,
  );
});
