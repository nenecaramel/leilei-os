import assert from "node:assert/strict";
import test from "node:test";
import {
  THEME_CACHE_KEY,
  THEME_CACHE_VERSION,
  createThemeCache,
  createThemeVariables,
  parseThemeCache,
  readThemeCache,
  syncThemeColorMeta,
  writeThemeCache,
} from "../web/src/settings/theme.js";

test("theme cache serializes one deterministic variable set", () => {
  const cache = createThemeCache("#d7a928");
  assert.ok(cache);
  assert.equal(cache.accentColor, "#d7a928");
  assert.equal(cache.variables["--theme"], "#d7a928");
  assert.equal(parseThemeCache(JSON.stringify(cache))?.accentColor, "#d7a928");
  assert.equal(THEME_CACHE_KEY, "leilei-os.theme.v1");
  assert.equal(THEME_CACHE_VERSION, 2);
});

test("theme cache safely rejects invalid colors and corrupted values", () => {
  assert.equal(createThemeVariables("not-a-color"), null);
  assert.equal(parseThemeCache("not-json"), null);
  assert.equal(parseThemeCache(JSON.stringify({ version: 1, accentColor: "#bad", variables: {} })), null);
  assert.equal(parseThemeCache(JSON.stringify({ version: 1, accentColor: "#405f4d", variables: {} })), null);
});

test("theme cache handles unavailable browser storage safely", () => {
  const unavailableStorage = {
    getItem() {
      throw new Error("Storage is unavailable");
    },
    setItem() {
      throw new Error("Storage is unavailable");
    },
  } as unknown as Storage;

  assert.equal(readThemeCache(unavailableStorage), null);
  assert.equal(writeThemeCache(unavailableStorage, "#405f4d")?.accentColor, "#405f4d");
});

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrast(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

test("theme brand and Hero variables remain contrast-safe across accent extremes", () => {
  for (const accent of ["#405f4d", "#111111", "#ffffff", "#ffd400", "#00bcd4", "#ff2d75"]) {
    const variables = createThemeVariables(accent);
    assert.ok(variables);
    assert.equal(variables["--theme-brand"], accent);
    assert.ok(contrast(accent, variables["--theme-on-brand"]!) >= 4.5);
    assert.notEqual(variables["--theme-hero-start"], variables["--theme-strong"]);
    assert.notEqual(variables["--theme-hero-end"], variables["--theme-deep"]);
    assert.ok(luminance(variables["--theme-hero-start"]!) > 0.35);
    assert.ok(luminance(variables["--theme-hero-end"]!) > 0.35);
    for (const endpoint of [variables["--theme-hero-start"]!, variables["--theme-hero-end"]!]) {
      assert.ok(contrast(endpoint, variables["--theme-on-hero"]!) >= 4.5);
      assert.ok(contrast(endpoint, variables["--theme-on-hero-muted"]!) >= 4.5);
    }
    for (const name of [
      "--theme-brand", "--theme-on-brand", "--theme-hero-start", "--theme-hero-end",
      "--theme-on-hero", "--theme-on-hero-muted", "--theme-hero-glow", "--theme-hero-overlay",
      "--theme-hero-border",
    ]) {
      assert.match(variables[name]!, /^(#[0-9a-f]{6}|rgba\([^)]*\))$/i, `${name} must be a CSS color`);
    }
  }
});

test("theme cache rejects v1 and round-trips v2", () => {
  const cache = createThemeCache("#405f4d");
  assert.ok(cache);
  assert.equal(parseThemeCache(JSON.stringify({ ...cache, version: 1 })), null);
  assert.deepEqual(parseThemeCache(JSON.stringify(cache)), cache);
});

test("theme color meta follows the page background and not the accent", () => {
  let value = "#f3f1eb";
  const documentRef = {
    querySelector() {
      return { setAttribute(_name: string, next: string) { value = next; } };
    },
  } as unknown as Document;
  const variables = createThemeVariables("#d7a928");
  assert.ok(variables);
  syncThemeColorMeta(documentRef, variables["--theme-page-background"]!);
  assert.equal(value, variables["--theme-page-background"]);
  assert.notEqual(value, "#d7a928");
});
