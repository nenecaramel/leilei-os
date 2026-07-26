import assert from "node:assert/strict";
import test from "node:test";
import {
  SETTINGS_CACHE_KEY,
  createSettingsCache,
  getInitialSettings,
  readSettingsCache,
  writeSettingsCache,
} from "../web/src/settings/cache.js";
import { DEFAULT_SETTINGS, type SettingsData } from "../web/src/settings/types.js";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function createSettings(overrides: Partial<SettingsData> = {}): SettingsData {
  return {
    ...DEFAULT_SETTINGS,
    accent_color: "#c76d91",
    home_title: "你好，冰格蕾。",
    home_subtitle: "今天也继续照顾自己的节奏。",
    preferred_name: "冰格蕾",
    page_copy: {
      ...DEFAULT_SETTINGS.page_copy,
      home_hero_eyebrow: "ice g lei",
      home_hero_title_mode: "custom",
      home_hero_title: "我的系统正在稳定生长。",
      home_hero_description_mode: "custom",
      home_hero_description: "每一件重要的小事都在被温柔照看。",
    },
    updated_at: "2026-07-26T01:00:00.000Z",
    ...overrides,
  };
}

test("cached settings supply all dashboard copy before the first render", () => {
  const storage = createStorage();
  const settings = createSettings();
  writeSettingsCache(storage, settings);

  const initial = getInitialSettings(storage);
  assert.equal(initial.home_title, "你好，冰格蕾。");
  assert.equal(initial.home_subtitle, "今天也继续照顾自己的节奏。");
  assert.equal(initial.page_copy.home_hero_eyebrow, "ice g lei");
  assert.equal(initial.page_copy.home_hero_title, "我的系统正在稳定生长。");
  assert.equal(initial.page_copy.home_hero_description, "每一件重要的小事都在被温柔照看。");
  assert.notEqual(initial.home_title, `${"早上好"}，蕾蕾`);
});

test("server settings replace the complete cached snapshot", () => {
  const storage = createStorage();
  writeSettingsCache(storage, createSettings());

  const serverSettings = createSettings({
    home_title: "晚上好，蕾蕾。",
    home_subtitle: "服务器设置已经同步。",
    page_copy: {
      ...DEFAULT_SETTINGS.page_copy,
      home_hero_eyebrow: "server copy",
      home_hero_title_mode: "auto",
      home_hero_title: null,
      home_hero_description_mode: "auto",
      home_hero_description: null,
    },
  });
  writeSettingsCache(storage, serverSettings);

  assert.equal(storage.length, 1);
  assert.deepEqual(readSettingsCache(storage)?.settings, serverSettings);
  assert.equal(getInitialSettings(storage).page_copy.home_hero_eyebrow, "server copy");
});

test("corrupted settings cache safely falls back to defaults", () => {
  const storage = createStorage();
  storage.setItem(SETTINGS_CACHE_KEY, "not-json");

  assert.equal(readSettingsCache(storage), null);
  assert.deepEqual(getInitialSettings(storage), DEFAULT_SETTINGS);
  assert.equal(createSettingsCache({ ...DEFAULT_SETTINGS, accent_color: "invalid" }), null);
});
