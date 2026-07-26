import type { UserPageCopy } from "../../database/schema.js";
import type {
  SettingsRepository,
  UserSettingsRecord,
} from "./settings-repository.js";

const DEFAULT_ACCENT_COLOR = "#405f4d";

const MAX_HOME_TITLE_LENGTH = 120;
const MAX_HOME_SUBTITLE_LENGTH = 240;
const MAX_PREFERRED_NAME_LENGTH = 80;
const MAX_PAGE_SUBTITLE_LENGTH = 240;
const MAX_HOME_HERO_EYEBROW_LENGTH = 120;
const MAX_HOME_HERO_TITLE_LENGTH = 240;
const MAX_HOME_HERO_DESCRIPTION_LENGTH = 500;

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export type ReadSettingsInput = {
  userId: string;
};

export type PageCopyInput = {
  memorySubtitle?: string | null;
  diarySubtitle?: string | null;
  taskSubtitle?: string | null;
  settingsSubtitle?: string | null;
  homeHeroEyebrow?: string | null;
  homeHeroTitleMode?: "auto" | "custom";
  homeHeroTitle?: string | null;
  homeHeroDescriptionMode?: "auto" | "custom";
  homeHeroDescription?: string | null;
};

export type SaveSettingsInput = {
  userId: string;
  accentColor: string;
  homeTitle?: string | null;
  homeSubtitle?: string | null;
  preferredName?: string | null;
  pageCopy?: PageCopyInput;
};

export type PageCopyResult = {
  memory_subtitle: string | null;
  diary_subtitle: string | null;
  task_subtitle: string | null;
  settings_subtitle: string | null;
  home_hero_eyebrow: string | null;
  home_hero_title_mode: "auto" | "custom";
  home_hero_title: string | null;
  home_hero_description_mode: "auto" | "custom";
  home_hero_description: string | null;
};

export type SettingsResult = {
  accent_color: string;
  home_title: string | null;
  home_subtitle: string | null;
  preferred_name: string | null;
  page_copy: PageCopyResult;
  updated_at: string | null;
};

export type SettingsDomainErrorCode =
  | "INVALID_ACCENT_COLOR"
  | "HOME_TITLE_TOO_LONG"
  | "HOME_SUBTITLE_TOO_LONG"
  | "PREFERRED_NAME_TOO_LONG"
  | "PAGE_COPY_TOO_LONG"
  | "INVALID_HOME_HERO_TITLE_MODE"
  | "CUSTOM_HOME_HERO_TITLE_REQUIRED"
  | "INVALID_HOME_HERO_DESCRIPTION_MODE";

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
    const settings = await this.repository.findByUserId(
      input.userId,
    );

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

    const existing = await this.repository.findByUserId(
      input.userId,
    );

    const pageCopy = this.normalizePageCopy(
      input.pageCopy,
      existing?.pageCopy ?? {},
    );

    const settings = await this.repository.save({
      userId: input.userId,
      accentColor,
      homeTitle,
      homeSubtitle,
      preferredName,
      pageCopy,
    });

    return this.toResult(settings);
  }

  async resetSettings(
    userId: string,
  ): Promise<SettingsResult> {
    await this.repository.reset(userId);

    return this.defaultSettings();
  }

  private normalizePageCopy(
    input: PageCopyInput | undefined,
    existing: UserPageCopy,
  ): UserPageCopy {
    if (!input) {
      return existing;
    }

    const pageCopy: UserPageCopy = {};

    const memorySubtitle = this.normalizePageText(
      input.memorySubtitle,
      existing.memorySubtitle,
      MAX_PAGE_SUBTITLE_LENGTH,
      "Memory subtitle",
    );

    const diarySubtitle = this.normalizePageText(
      input.diarySubtitle,
      existing.diarySubtitle,
      MAX_PAGE_SUBTITLE_LENGTH,
      "Diary subtitle",
    );

    const taskSubtitle = this.normalizePageText(
      input.taskSubtitle,
      existing.taskSubtitle,
      MAX_PAGE_SUBTITLE_LENGTH,
      "Task subtitle",
    );

    const settingsSubtitle = this.normalizePageText(
      input.settingsSubtitle,
      existing.settingsSubtitle,
      MAX_PAGE_SUBTITLE_LENGTH,
      "Settings subtitle",
    );

    if (memorySubtitle) {
      pageCopy.memorySubtitle = memorySubtitle;
    }

    if (diarySubtitle) {
      pageCopy.diarySubtitle = diarySubtitle;
    }

    if (taskSubtitle) {
      pageCopy.taskSubtitle = taskSubtitle;
    }

    if (settingsSubtitle) {
      pageCopy.settingsSubtitle = settingsSubtitle;
    }

    pageCopy.homeHeroEyebrow =
      this.normalizeNullablePageText(
        input.homeHeroEyebrow,
        existing.homeHeroEyebrow,
        MAX_HOME_HERO_EYEBROW_LENGTH,
        "Home hero eyebrow",
      );

    const titleMode =
      input.homeHeroTitleMode ??
      existing.homeHeroTitleMode ??
      "auto";

    if (titleMode !== "auto" && titleMode !== "custom") {
      throw new SettingsDomainError(
        "INVALID_HOME_HERO_TITLE_MODE",
        "Home hero title mode must be auto or custom.",
      );
    }

    const homeHeroTitle = this.normalizeNullablePageText(
      input.homeHeroTitle,
      existing.homeHeroTitle,
      MAX_HOME_HERO_TITLE_LENGTH,
      "Home hero title",
    );

    if (titleMode === "custom" && !homeHeroTitle) {
      throw new SettingsDomainError(
        "CUSTOM_HOME_HERO_TITLE_REQUIRED",
        "A custom home hero title is required when custom mode is selected.",
      );
    }

    pageCopy.homeHeroTitleMode = titleMode;
    pageCopy.homeHeroTitle = homeHeroTitle;

    const descriptionMode =
      input.homeHeroDescriptionMode ??
      existing.homeHeroDescriptionMode ??
      "auto";

    if (
      descriptionMode !== "auto" &&
      descriptionMode !== "custom"
    ) {
      throw new SettingsDomainError(
        "INVALID_HOME_HERO_DESCRIPTION_MODE",
        "Home hero description mode must be auto or custom.",
      );
    }

    pageCopy.homeHeroDescriptionMode = descriptionMode;

    pageCopy.homeHeroDescription =
      this.normalizeNullablePageText(
        input.homeHeroDescription,
        existing.homeHeroDescription,
        MAX_HOME_HERO_DESCRIPTION_LENGTH,
        "Home hero description",
      );

    return pageCopy;
  }

  private normalizePageText(
    value: string | null | undefined,
    existing: string | undefined,
    maxLength: number,
    label: string,
  ): string | undefined {
    if (value === undefined) {
      return existing;
    }

    if (value === null) {
      return undefined;
    }

    const normalized = value.trim();

    if (!normalized) {
      return undefined;
    }

    if (normalized.length > maxLength) {
      throw new SettingsDomainError(
        "PAGE_COPY_TOO_LONG",
        `${label} must not exceed ${maxLength} characters.`,
      );
    }

    return normalized;
  }

  private normalizeNullablePageText(
    value: string | null | undefined,
    existing: string | null | undefined,
    maxLength: number,
    label: string,
  ): string | null {
    if (value === undefined) {
      return existing ?? null;
    }

    if (value === null) {
      return null;
    }

    const normalized = value.trim();

    if (!normalized) {
      return null;
    }

    if (normalized.length > maxLength) {
      throw new SettingsDomainError(
        "PAGE_COPY_TOO_LONG",
        `${label} must not exceed ${maxLength} characters.`,
      );
    }

    return normalized;
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

    if (!normalized) {
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

  private toResult(
    settings: UserSettingsRecord,
  ): SettingsResult {
    return {
      accent_color: settings.accentColor,
      home_title: settings.homeTitle,
      home_subtitle: settings.homeSubtitle,
      preferred_name: settings.preferredName,
      page_copy: {
        memory_subtitle:
          settings.pageCopy.memorySubtitle ?? null,
        diary_subtitle:
          settings.pageCopy.diarySubtitle ?? null,
        task_subtitle:
          settings.pageCopy.taskSubtitle ?? null,
        settings_subtitle:
          settings.pageCopy.settingsSubtitle ?? null,
        home_hero_eyebrow:
          settings.pageCopy.homeHeroEyebrow ?? null,
        home_hero_title_mode:
          settings.pageCopy.homeHeroTitleMode ??
          "auto",
        home_hero_title:
          settings.pageCopy.homeHeroTitle ?? null,
        home_hero_description_mode:
          settings.pageCopy.homeHeroDescriptionMode ??
          "auto",
        home_hero_description:
          settings.pageCopy.homeHeroDescription ?? null,
      },
      updated_at: settings.updatedAt.toISOString(),
    };
  }

  private defaultSettings(): SettingsResult {
    return {
      accent_color: DEFAULT_ACCENT_COLOR,
      home_title: null,
      home_subtitle: null,
      preferred_name: null,
      page_copy: {
        memory_subtitle: null,
        diary_subtitle: null,
        task_subtitle: null,
        settings_subtitle: null,
        home_hero_eyebrow: null,
        home_hero_title_mode: "auto",
        home_hero_title: null,
        home_hero_description_mode: "auto",
        home_hero_description: null,
      },
      updated_at: null,
    };
  }
}
