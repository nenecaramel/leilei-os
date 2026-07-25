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

  const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

  export type PageCopyData = {
    memory_subtitle: string | null;
    diary_subtitle: string | null;
    task_subtitle: string | null;
    settings_subtitle: string | null;
    home_hero_eyebrow: string | null;
    home_hero_description_mode: "auto" | "custom";
    home_hero_description: string | null;
  };

  export type SettingsData = {
    accent_color: string;
    home_title: string | null;
    home_subtitle: string | null;
    preferred_name: string | null;
    page_copy: PageCopyData;
    updated_at: string | null;
  };

  export type SaveSettingsInput = {
    accent_color: string;
    home_title: string | null;
    home_subtitle: string | null;
    preferred_name: string | null;
    page_copy: PageCopyData;
  };

  export const DEFAULT_PAGE_COPY: PageCopyData = {
    memory_subtitle: null,
    diary_subtitle: null,
    task_subtitle: null,
    settings_subtitle: null,
    home_hero_eyebrow: null,
    home_hero_description_mode: "auto",
    home_hero_description: null,
  };

  export const DEFAULT_SETTINGS: SettingsData = {
    accent_color: "#405f4d",
    home_title: null,
    home_subtitle: null,
    preferred_name: null,
    page_copy: DEFAULT_PAGE_COPY,
    updated_at: null,
  };

  type SettingsPayload = Omit<SettingsData, "page_copy"> & {
    page_copy?: Partial<PageCopyData>;
  };

  type SettingsResponse = {
    success: true;
    data: SettingsPayload;
  };

  type SettingsStatus = "loading" | "ready" | "error";

  type SettingsContextValue = {
    status: SettingsStatus;
    settings: SettingsData;
    reloadSettings(): void;
    saveSettings(
      input: SaveSettingsInput,
    ): Promise<SettingsData>;
    resetSettings(): Promise<SettingsData>;
    previewAccentColor(color: string): void;
    clearAccentPreview(): void;
  };

  const SettingsContext =
    createContext<SettingsContextValue | null>(null);

  export function SettingsProvider({
    children,
  }: PropsWithChildren) {
    const api = useWebApiClient();

    const [reloadKey, setReloadKey] = useState(0);
    const [status, setStatus] =
      useState<SettingsStatus>("loading");

    const [settings, setSettings] =
      useState<SettingsData>(DEFAULT_SETTINGS);

    const [accentPreview, setAccentPreview] =
      useState<string | null>(null);

    useEffect(() => {
      let active = true;

      setStatus("loading");

      api.request<SettingsResponse>("/settings")
        .then((response) => {
          if (!active) {
            return;
          }

          setSettings(normalizeSettings(response.data));
          setAccentPreview(null);
          setStatus("ready");
        })
        .catch(() => {
          if (active) {
            setStatus("error");
          }
        });

      return () => {
        active = false;
      };
    }, [api, reloadKey]);

    useEffect(() => {
      const themeColor =
        accentPreview ?? settings.accent_color;

      applyThemeColor(themeColor);
    }, [accentPreview, settings.accent_color]);

    useEffect(() => {
      return () => {
        applyThemeColor(DEFAULT_SETTINGS.accent_color);
      };
    }, []);

    const reloadSettings = useCallback(() => {
      setReloadKey((value) => value + 1);
    }, []);

    const saveSettings = useCallback(
      async (
        input: SaveSettingsInput,
      ): Promise<SettingsData> => {
        const response =
          await api.request<SettingsResponse>("/settings", {
            method: "PATCH",
            body: JSON.stringify(input),
          });

        const nextSettings = normalizeSettings(
          response.data,
        );

        setSettings(nextSettings);
        setAccentPreview(null);
        setStatus("ready");

        return nextSettings;
      },
      [api],
    );

    const resetSettings =
      useCallback(async (): Promise<SettingsData> => {
        const response =
          await api.request<SettingsResponse>("/settings", {
            method: "DELETE",
          });

        const nextSettings = normalizeSettings(
          response.data,
        );

        setSettings(nextSettings);
        setAccentPreview(null);
        setStatus("ready");

        return nextSettings;
      }, [api]);

    const previewAccentColor = useCallback(
      (color: string) => {
        if (HEX_COLOR_PATTERN.test(color)) {
          setAccentPreview(color);
        }
      },
      [],
    );

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

    return (
      <SettingsContext.Provider value={value}>
        {children}
      </SettingsContext.Provider>
    );
  }

  export function useSettings(): SettingsContextValue {
    const context = useContext(SettingsContext);

    if (!context) {
      throw new Error(
        "useSettings must be used inside SettingsProvider.",
      );
    }

    return context;
  }

  function normalizeSettings(
    payload: SettingsPayload,
  ): SettingsData {
    return {
      accent_color:
        payload.accent_color ||
        DEFAULT_SETTINGS.accent_color,
      home_title: payload.home_title ?? null,
      home_subtitle: payload.home_subtitle ?? null,
      preferred_name: payload.preferred_name ?? null,
      page_copy: {
        ...DEFAULT_PAGE_COPY,
        ...(payload.page_copy ?? {}),
      },
      updated_at: payload.updated_at ?? null,
    };
  }

  function applyThemeColor(color: string) {
    const accent = parseHexColor(color);

    if (!accent) {
      return;
    }

    const black: RgbColor = {
      red: 0,
      green: 0,
      blue: 0,
    };

    const white: RgbColor = {
      red: 255,
      green: 255,
      blue: 255,
    };

    const basePage: RgbColor = {
      red: 243,
      green: 241,
      blue: 235,
    };

    const baseSurface: RgbColor = {
      red: 250,
      green: 248,
      blue: 243,
    };

    const baseSidebar: RgbColor = {
      red: 248,
      green: 246,
      blue: 240,
    };

    const luminance = getRelativeLuminance(accent);
    const isBright = luminance > 0.56;

    const strong = mixColor(
      accent,
      black,
      isBright ? 0.42 : 0.18,
    );

    const deep = mixColor(
      accent,
      black,
      isBright ? 0.64 : 0.46,
    );

    const soft = mixColor(
      accent,
      white,
      isBright ? 0.72 : 0.78,
    );

    const pale = mixColor(accent, white, 0.9);

    const pageBackground = mixColor(
      basePage,
      accent,
      isBright ? 0.065 : 0.045,
    );

    const surface = mixColor(
      baseSurface,
      accent,
      0.035,
    );

    const sidebar = mixColor(
      baseSidebar,
      accent,
      0.045,
    );

    const root = document.documentElement;

    const accentHex = toHexColor(accent);
    const strongHex = toHexColor(strong);
    const deepHex = toHexColor(deep);
    const softHex = toHexColor(soft);
    const paleHex = toHexColor(pale);

    root.style.setProperty("--theme", accentHex);
    root.style.setProperty("--theme-strong", strongHex);
    root.style.setProperty("--theme-deep", deepHex);
    root.style.setProperty("--theme-soft", softHex);
    root.style.setProperty("--theme-pale", paleHex);

    root.style.setProperty(
      "--theme-rgb",
      `${accent.red}, ${accent.green}, ${accent.blue}`,
    );

    root.style.setProperty(
      "--theme-strong-rgb",
      `${strong.red}, ${strong.green}, ${strong.blue}`,
    );

    root.style.setProperty(
      "--theme-deep-rgb",
      `${deep.red}, ${deep.green}, ${deep.blue}`,
    );

    root.style.setProperty(
      "--theme-on-accent",
      isBright ? "#25302a" : "#f8f5ec",
    );

    root.style.setProperty(
      "--theme-on-hero",
      "#f8f5ec",
    );

    root.style.setProperty(
      "--theme-page-background",
      toHexColor(pageBackground),
    );

    root.style.setProperty(
      "--theme-surface",
      toHexColor(surface),
    );

    root.style.setProperty(
      "--theme-sidebar",
      toHexColor(sidebar),
    );

    root.style.setProperty(
      "--theme-page-glow",
      `rgba(${accent.red}, ${accent.green}, ${accent.blue}, 0.2)`,
    );

    root.style.setProperty(
      "--theme-page-glow-soft",
      `rgba(${accent.red}, ${accent.green}, ${accent.blue}, 0.1)`,
    );

    root.style.setProperty(
      "--theme-hero-start",
      deepHex,
    );

    root.style.setProperty(
      "--theme-hero-end",
      strongHex,
    );

    root.style.setProperty(
      "--theme-hero-glow",
      `rgba(${accent.red}, ${accent.green}, ${accent.blue}, 0.34)`,
    );

    root.style.setProperty(
      "--theme-hover-background",
      `rgba(${accent.red}, ${accent.green}, ${accent.blue}, 0.07)`,
    );

    root.style.setProperty(
      "--theme-border",
      `rgba(${deep.red}, ${deep.green}, ${deep.blue}, 0.11)`,
    );

    root.style.setProperty(
      "--theme-border-strong",
      `rgba(${deep.red}, ${deep.green}, ${deep.blue}, 0.18)`,
    );

    root.style.setProperty(
      "--theme-shadow-color",
      `rgba(${deep.red}, ${deep.green}, ${deep.blue}, 0.11)`,
    );

    root.style.setProperty(
      "--focus-ring",
      `0 0 0 4px rgba(${accent.red}, ${accent.green}, ${accent.blue}, 0.15)`,
    );

    root.style.setProperty(
      "--shadow-soft",
      `0 18px 42px rgba(${deep.red}, ${deep.green}, ${deep.blue}, 0.06)`,
    );

    root.style.setProperty(
      "--shadow-card",
      `0 22px 54px rgba(${deep.red}, ${deep.green}, ${deep.blue}, 0.09)`,
    );

    root.style.setProperty("--green", accentHex);
    root.style.setProperty("--green-dark", strongHex);
    root.style.setProperty("--green-soft", softHex);
    root.style.setProperty("--line", "var(--theme-border)");
    root.style.setProperty(
      "--line-strong",
      "var(--theme-border-strong)",
    );
    root.style.setProperty(
      "--cream",
      "var(--theme-surface)",
    );
  }

  type RgbColor = {
    red: number;
    green: number;
    blue: number;
  };

  function parseHexColor(
    value: string,
  ): RgbColor | null {
    if (!HEX_COLOR_PATTERN.test(value)) {
      return null;
    }

    return {
      red: Number.parseInt(value.slice(1, 3), 16),
      green: Number.parseInt(value.slice(3, 5), 16),
      blue: Number.parseInt(value.slice(5, 7), 16),
    };
  }

  function mixColor(
    first: RgbColor,
    second: RgbColor,
    amount: number,
  ): RgbColor {
    return {
      red: Math.round(
        first.red +
          (second.red - first.red) * amount,
      ),
      green: Math.round(
        first.green +
          (second.green - first.green) * amount,
      ),
      blue: Math.round(
        first.blue +
          (second.blue - first.blue) * amount,
      ),
    };
  }

  function getRelativeLuminance(
    color: RgbColor,
  ): number {
    const channels = [
      color.red,
      color.green,
      color.blue,
    ].map((value) => {
      const channel = value / 255;

      return channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });

    return (
      channels[0] * 0.2126 +
      channels[1] * 0.7152 +
      channels[2] * 0.0722
    );
  }

  function toHexColor(color: RgbColor): string {
    return `#${[
      color.red,
      color.green,
      color.blue,
    ]
      .map((value) =>
        value.toString(16).padStart(2, "0"),
      )
      .join("")}`;
  }