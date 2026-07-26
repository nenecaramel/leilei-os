import assert from "node:assert/strict";
import test from "node:test";
import {
  THEME_CACHE_KEY,
  createThemeCache,
  createThemeVariables,
  parseThemeCache,
  readThemeCache,
  writeThemeCache,
} from "../web/src/settings/theme.js";

test("theme cache serializes one deterministic variable set", () => {
  const cache = createThemeCache("#d7a928");
  assert.ok(cache);
  assert.equal(cache.accentColor, "#d7a928");
  assert.equal(cache.variables["--theme"], "#d7a928");
  assert.equal(parseThemeCache(JSON.stringify(cache))?.accentColor, "#d7a928");
  assert.equal(THEME_CACHE_KEY, "leilei-os.theme.v1");
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
