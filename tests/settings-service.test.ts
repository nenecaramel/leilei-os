import assert from "node:assert/strict";
import test from "node:test";
import type { UserPageCopy } from "../src/database/schema.js";
import {
  SettingsDomainError,
  SettingsService,
} from "../src/domains/settings/settings-service.js";
import type {
  SettingsRepository,
  UserSettingsRecord,
} from "../src/domains/settings/settings-repository.js";

const USER_ID = "00000000-0000-4000-8000-000000000091";

function createRepository(initial: UserSettingsRecord | null = null): SettingsRepository {
  let settings = initial;

  return {
    async findByUserId() {
      return settings;
    },
    async save(input) {
      settings = {
        accentColor: input.accentColor,
        homeTitle: input.homeTitle,
        homeSubtitle: input.homeSubtitle,
        preferredName: input.preferredName,
        pageCopy: input.pageCopy,
        updatedAt: new Date("2026-07-26T00:00:00.000Z"),
      };
      return settings;
    },
    async reset() {
      settings = null;
    },
  };
}

test("defaults the home hero title to automatic mode", async () => {
  const service = new SettingsService(createRepository());
  const settings = await service.readSettings({ userId: USER_ID });

  assert.equal(settings.page_copy.home_hero_title_mode, "auto");
  assert.equal(settings.page_copy.home_hero_title, null);
});

test("saves and re-reads custom home hero titles", async () => {
  const service = new SettingsService(createRepository());
  const saved = await service.saveSettings({
    userId: USER_ID,
    accentColor: "#405f4d",
    pageCopy: {
      homeHeroTitleMode: "custom",
      homeHeroTitle: "  让生活重新回到自己的节奏  ",
    },
  });

  assert.equal(saved.page_copy.home_hero_title_mode, "custom");
  assert.equal(saved.page_copy.home_hero_title, "让生活重新回到自己的节奏");

  const reread = await service.readSettings({ userId: USER_ID });
  assert.deepEqual(reread.page_copy, saved.page_copy);
});

test("keeps a custom title when switching back to automatic mode", async () => {
  const existing: UserSettingsRecord = {
    accentColor: "#405f4d",
    homeTitle: null,
    homeSubtitle: null,
    preferredName: null,
    pageCopy: {
      homeHeroTitleMode: "custom",
      homeHeroTitle: "我的自定义标题",
    } satisfies UserPageCopy,
    updatedAt: new Date("2026-07-26T00:00:00.000Z"),
  };
  const service = new SettingsService(createRepository(existing));
  const saved = await service.saveSettings({
    userId: USER_ID,
    accentColor: "#405f4d",
    pageCopy: { homeHeroTitleMode: "auto" },
  });

  assert.equal(saved.page_copy.home_hero_title_mode, "auto");
  assert.equal(saved.page_copy.home_hero_title, "我的自定义标题");
});

test("rejects blank custom home hero titles", async () => {
  const service = new SettingsService(createRepository());

  await assert.rejects(
    service.saveSettings({
      userId: USER_ID,
      accentColor: "#405f4d",
      pageCopy: {
        homeHeroTitleMode: "custom",
        homeHeroTitle: "   ",
      },
    }),
    (error: unknown) =>
      error instanceof SettingsDomainError &&
      error.code === "CUSTOM_HOME_HERO_TITLE_REQUIRED",
  );
});
