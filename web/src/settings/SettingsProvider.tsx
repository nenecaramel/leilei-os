import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    type PropsWithChildren,
  } from "react";
  import { useWebApiClient } from "../api/useWebApiClient";
  
  export const DEFAULT_SETTINGS = {
    accent_color: "#405f4d",
    home_title: null,
    home_subtitle: null,
    preferred_name: null,
    updated_at: null,
  } satisfies SettingsData;
  
  const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
  
  export type SettingsData = {
    accent_color: string;
    home_title: string | null;
    home_subtitle: string | null;
    preferred_name: string | null;
    updated_at: string | null;
  };
  
  export type SaveSettingsInput = {
    accent_color: string;
    home_title: string | null;
    home_subtitle: string | null;
    preferred_name: string | null;
  };
  
  type SettingsResponse = {
    success: true;
    data: SettingsData;
  };
  
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
  
          setSettings(response.data);
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
      const accentColor =
        accentPreview ?? settings.accent_color;
  
      applyAccentColor(accentColor);
    }, [accentPreview, settings.accent_color]);
  
    useEffect(() => {
      return () => {
        applyAccentColor(DEFAULT_SETTINGS.accent_color);
      };
    }, []);
  
    const value = useMemo<SettingsContextValue>(
      () => ({
        status,
        settings,
  
        reloadSettings() {
          setReloadKey((value) => value + 1);
        },
  
        async saveSettings(input) {
          const response =
            await api.request<SettingsResponse>("/settings", {
              method: "PATCH",
              body: JSON.stringify(input),
            });
  
          setSettings(response.data);
          setAccentPreview(null);
          setStatus("ready");
  
          return response.data;
        },
  
        async resetSettings() {
          const response =
            await api.request<SettingsResponse>("/settings", {
              method: "DELETE",
            });
  
          setSettings(response.data);
          setAccentPreview(null);
          setStatus("ready");
  
          return response.data;
        },
  
        previewAccentColor(color) {
          if (HEX_COLOR_PATTERN.test(color)) {
            setAccentPreview(color);
          }
        },
  
        clearAccentPreview() {
          setAccentPreview(null);
        },
      }),
      [api, settings, status],
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
  
  function applyAccentColor(color: string) {
    const rgb = parseHexColor(color);
  
    if (!rgb) {
      return;
    }
  
    const root = document.documentElement;
    const dark = mixColor(rgb, { red: 0, green: 0, blue: 0 }, 0.18);
    const soft = mixColor(
      rgb,
      { red: 255, green: 255, blue: 255 },
      0.78,
    );
  
    root.style.setProperty("--green", color);
    root.style.setProperty("--green-dark", toHexColor(dark));
    root.style.setProperty("--green-soft", toHexColor(soft));
    root.style.setProperty(
      "--focus-ring",
      `0 0 0 4px rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, 0.14)`,
    );
  }
  
  type RgbColor = {
    red: number;
    green: number;
    blue: number;
  };
  
  function parseHexColor(value: string): RgbColor | null {
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
        first.red + (second.red - first.red) * amount,
      ),
      green: Math.round(
        first.green +
          (second.green - first.green) * amount,
      ),
      blue: Math.round(
        first.blue + (second.blue - first.blue) * amount,
      ),
    };
  }
  
  function toHexColor(color: RgbColor): string {
    return `#${[color.red, color.green, color.blue]
      .map((value) =>
        value.toString(16).padStart(2, "0"),
      )
      .join("")}`;
  }