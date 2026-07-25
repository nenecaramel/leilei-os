import type {
    SettingsRepository,
    UserSettingsRecord,
  } from "./settings-repository.js";
  
  const DEFAULT_ACCENT_COLOR = "#405f4d";
  const MAX_HOME_TITLE_LENGTH = 120;
  const MAX_HOME_SUBTITLE_LENGTH = 240;
  const MAX_PREFERRED_NAME_LENGTH = 80;
  const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
  
  export type ReadSettingsInput = {
    userId: string;
  };
  
  export type SaveSettingsInput = {
    userId: string;
    accentColor: string;
    homeTitle?: string | null;
    homeSubtitle?: string | null;
    preferredName?: string | null;
  };
  
  export type SettingsResult = {
    accent_color: string;
    home_title: string | null;
    home_subtitle: string | null;
    preferred_name: string | null;
    updated_at: string | null;
  };
  
  export type SettingsDomainErrorCode =
    | "INVALID_ACCENT_COLOR"
    | "HOME_TITLE_TOO_LONG"
    | "HOME_SUBTITLE_TOO_LONG"
    | "PREFERRED_NAME_TOO_LONG";
  
  export class SettingsDomainError extends Error {
    constructor(
      readonly code: SettingsDomainErrorCode,
      message: string,
    ) {
      super(message);
      this.name = "SettingsDomainError";
    }
  }
  
  export class SettingsService {
    constructor(private readonly repository: SettingsRepository) {}
  
    async readSettings(
      input: ReadSettingsInput,
    ): Promise<SettingsResult> {
      const settings = await this.repository.findByUserId(input.userId);
  
      if (!settings) {
        return this.defaultSettings();
      }
  
      return this.toResult(settings);
    }
  
    async saveSettings(
      input: SaveSettingsInput,
    ): Promise<SettingsResult> {
      const accentColor = input.accentColor.trim();
  
      if (!HEX_COLOR_PATTERN.test(accentColor)) {
        throw new SettingsDomainError(
          "INVALID_ACCENT_COLOR",
          "Accent color must use the #RRGGBB format.",
        );
      }
  
      const homeTitle = this.normalizeOptionalText(
        input.homeTitle,
        MAX_HOME_TITLE_LENGTH,
        "HOME_TITLE_TOO_LONG",
        "Home title",
      );
  
      const homeSubtitle = this.normalizeOptionalText(
        input.homeSubtitle,
        MAX_HOME_SUBTITLE_LENGTH,
        "HOME_SUBTITLE_TOO_LONG",
        "Home subtitle",
      );
  
      const preferredName = this.normalizeOptionalText(
        input.preferredName,
        MAX_PREFERRED_NAME_LENGTH,
        "PREFERRED_NAME_TOO_LONG",
        "Preferred name",
      );
  
      const settings = await this.repository.save({
        userId: input.userId,
        accentColor,
        homeTitle,
        homeSubtitle,
        preferredName,
      });
  
      return this.toResult(settings);
    }
  
    async resetSettings(userId: string): Promise<SettingsResult> {
      await this.repository.reset(userId);
  
      return this.defaultSettings();
    }
  
    private normalizeOptionalText(
      value: string | null | undefined,
      maxLength: number,
      errorCode:
        | "HOME_TITLE_TOO_LONG"
        | "HOME_SUBTITLE_TOO_LONG"
        | "PREFERRED_NAME_TOO_LONG",
      label: string,
    ): string | null {
      if (value === undefined || value === null) {
        return null;
      }
  
      const normalized = value.trim();
  
      if (normalized.length === 0) {
        return null;
      }
  
      if (normalized.length > maxLength) {
        throw new SettingsDomainError(
          errorCode,
          `${label} must not exceed ${maxLength} characters.`,
        );
      }
  
      return normalized;
    }
  
    private toResult(settings: UserSettingsRecord): SettingsResult {
      return {
        accent_color: settings.accentColor,
        home_title: settings.homeTitle,
        home_subtitle: settings.homeSubtitle,
        preferred_name: settings.preferredName,
        updated_at: settings.updatedAt.toISOString(),
      };
    }
  
    private defaultSettings(): SettingsResult {
      return {
        accent_color: DEFAULT_ACCENT_COLOR,
        home_title: null,
        home_subtitle: null,
        preferred_name: null,
        updated_at: null,
      };
    }
  }