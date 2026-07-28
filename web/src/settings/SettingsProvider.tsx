import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useWebApiClient } from "../api/useWebApiClient";
import { applyThemeColor } from "./theme";
import {
  getInitialSettings,
  writeSettingsCache,
} from "./cache";
import {
  DEFAULT_PAGE_COPY,
  DEFAULT_SETTINGS,
  type PageCopyData,
  type SettingsData,
} from "./types";

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export type { PageCopyData, SettingsData } from "./types";

export type SaveSettingsInput = {
  accent_color: string;
  home_title: string | null;
  home_subtitle: string | null;
  preferred_name: string | null;
  timezone: string;
  page_copy: PageCopyData;
};

export { DEFAULT_PAGE_COPY, DEFAULT_SETTINGS } from "./types";

type SettingsPayload = Omit<SettingsData, "page_copy"> & {
  page_copy?: Partial<PageCopyData>;
};

type SettingsResponse = { success: true; data: SettingsPayload };
type SettingsStatus = "loading" | "ready" | "error";

type SettingsContextValue = {
  status: SettingsStatus;
  settings: SettingsData;
  reloadSettings(): void;
  saveSettings(input: SaveSettingsInput): Promise<SettingsData>;
  resetSettings(): Promise<SettingsData>;
  previewAccentColor(color: string): void;
  clearAccentPreview(): void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export { getInitialSettings } from "./cache";

function applyAndCacheSettings(settings: SettingsData): void {
  applyThemeColor(settings.accent_color);
  if (typeof window !== "undefined") {
    writeSettingsCache(window.localStorage, settings);
  }
}

export function SettingsProvider({ children }: PropsWithChildren) {
  const api = useWebApiClient();
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<SettingsStatus>("loading");
  const [settings, setSettings] = useState<SettingsData>(() =>
    getInitialSettings(
      typeof window === "undefined" ? undefined : window.localStorage,
    ),
  );
  const [accentPreview, setAccentPreview] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setStatus("loading");

    api.request<SettingsResponse>("/settings")
      .then((response) => {
        if (!active) return;
        const nextSettings = normalizeSettings(response.data);
        applyAndCacheSettings(nextSettings);
        setSettings(nextSettings);
        setAccentPreview(null);
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });

    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  useEffect(() => {
    applyThemeColor(accentPreview ?? settings.accent_color);
  }, [accentPreview, settings.accent_color]);

  const reloadSettings = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  const saveSettings = useCallback(
    async (input: SaveSettingsInput): Promise<SettingsData> => {
      const response = await api.request<SettingsResponse>("/settings", {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      const nextSettings = normalizeSettings(response.data);
      applyAndCacheSettings(nextSettings);
      setSettings(nextSettings);
      setAccentPreview(null);
      setStatus("ready");
      return nextSettings;
    },
    [api],
  );

  const resetSettings = useCallback(async (): Promise<SettingsData> => {
    const response = await api.request<SettingsResponse>("/settings", {
      method: "DELETE",
    });
    const nextSettings = normalizeSettings(response.data);
    applyAndCacheSettings(nextSettings);
    setSettings(nextSettings);
    setAccentPreview(null);
    setStatus("ready");
    return nextSettings;
  }, [api]);

  const previewAccentColor = useCallback((color: string) => {
    if (HEX_COLOR_PATTERN.test(color)) setAccentPreview(color);
  }, []);

  const clearAccentPreview = useCallback(() => {
    setAccentPreview(null);
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      status,
      settings,
      reloadSettings,
      saveSettings,
      resetSettings,
      previewAccentColor,
      clearAccentPreview,
    }),
    [
      status,
      settings,
      reloadSettings,
      saveSettings,
      resetSettings,
      previewAccentColor,
      clearAccentPreview,
    ],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used inside SettingsProvider.");
  }
  return context;
}

function normalizeSettings(payload: SettingsPayload): SettingsData {
  return {
    accent_color: payload.accent_color || DEFAULT_SETTINGS.accent_color,
    home_title: payload.home_title ?? null,
    home_subtitle: payload.home_subtitle ?? null,
    preferred_name: payload.preferred_name ?? null,
    timezone: payload.timezone || DEFAULT_SETTINGS.timezone,
    page_copy: {
      ...DEFAULT_PAGE_COPY,
      ...(payload.page_copy ?? {}),
    },
    updated_at: payload.updated_at ?? null,
  };
}
