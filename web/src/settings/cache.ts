import {
  DEFAULT_SETTINGS,
  type PageCopyData,
  type SettingsData,
} from "./types";
import {
  createThemeCache,
  readThemeCache,
  type ThemeCache,
} from "./theme";

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export const SETTINGS_CACHE_KEY = "leilei-os.settings.v1";
export const SETTINGS_CACHE_VERSION = 1;

export type SettingsCache = {
  version: typeof SETTINGS_CACHE_VERSION;
  settings: SettingsData;
  theme: ThemeCache;
};

export function createSettingsCache(settings: SettingsData): SettingsCache | null {
  const normalized = normalizeCachedSettings(settings);
  const theme = createThemeCache(normalized?.accent_color ?? "");
  if (!normalized || !theme) return null;

  return {
    version: SETTINGS_CACHE_VERSION,
    settings: normalized,
    theme,
  };
}

export function parseSettingsCache(raw: string | null): SettingsCache | null {
  if (!raw) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;

    const candidate = value as Partial<SettingsCache>;
    if (
      candidate.version !== SETTINGS_CACHE_VERSION ||
      !candidate.settings ||
      !candidate.theme
    ) return null;

    const settings = normalizeCachedSettings(candidate.settings);
    const expectedTheme = settings && createThemeCache(settings.accent_color);
    if (!settings || !expectedTheme || !isSameTheme(candidate.theme, expectedTheme)) {
      return null;
    }

    return {
      version: SETTINGS_CACHE_VERSION,
      settings,
      theme: expectedTheme,
    };
  } catch {
    return null;
  }
}

export function readSettingsCache(storage: Storage | undefined): SettingsCache | null {
  try {
    return parseSettingsCache(storage?.getItem(SETTINGS_CACHE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function writeSettingsCache(
  storage: Storage | undefined,
  settings: SettingsData,
): SettingsCache | null {
  const cache = createSettingsCache(settings);
  if (!cache) return null;

  try {
    storage?.setItem(SETTINGS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Local persistence is an enhancement; it must never block the UI.
  }

  return cache;
}

export function getInitialSettings(
  storage: Storage | undefined,
): SettingsData {
  const cachedSettings = readSettingsCache(storage);
  if (cachedSettings) return cachedSettings.settings;

  const cachedTheme = readThemeCache(storage);
  return {
    ...DEFAULT_SETTINGS,
    accent_color: cachedTheme?.accentColor ?? DEFAULT_SETTINGS.accent_color,
  };
}

function normalizeCachedSettings(value: unknown): SettingsData | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SettingsData>;

  if (
    typeof candidate.accent_color !== "string" ||
    !HEX_COLOR_PATTERN.test(candidate.accent_color) ||
    !isNullableString(candidate.home_title) ||
    !isNullableString(candidate.home_subtitle) ||
    !isNullableString(candidate.preferred_name) ||
    !isNullableString(candidate.updated_at) ||
    !isPageCopy(candidate.page_copy)
  ) return null;

  return {
    accent_color: candidate.accent_color,
    home_title: candidate.home_title,
    home_subtitle: candidate.home_subtitle,
    preferred_name: candidate.preferred_name,
    page_copy: { ...candidate.page_copy },
    updated_at: candidate.updated_at,
  };
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isPageCopy(value: unknown): value is PageCopyData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PageCopyData>;

  return (
    isNullableString(candidate.memory_subtitle) &&
    isNullableString(candidate.diary_subtitle) &&
    isNullableString(candidate.task_subtitle) &&
    isNullableString(candidate.settings_subtitle) &&
    isNullableString(candidate.home_hero_eyebrow) &&
    isNullableString(candidate.home_hero_title) &&
    isNullableString(candidate.home_hero_description) &&
    (candidate.home_hero_title_mode === "auto" || candidate.home_hero_title_mode === "custom") &&
    (candidate.home_hero_description_mode === "auto" || candidate.home_hero_description_mode === "custom")
  );
}

function isSameTheme(value: unknown, expected: ThemeCache): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ThemeCache>;
  if (
    candidate.version !== expected.version ||
    candidate.accentColor !== expected.accentColor ||
    !candidate.variables ||
    typeof candidate.variables !== "object" ||
    Array.isArray(candidate.variables)
  ) return false;

  const entries = Object.entries(expected.variables);
  return (
    Object.keys(candidate.variables).length === entries.length &&
    entries.every(([name, color]) => candidate.variables?.[name] === color)
  );
}
