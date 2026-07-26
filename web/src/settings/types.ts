export type PageCopyData = {
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

export type SettingsData = {
  accent_color: string;
  home_title: string | null;
  home_subtitle: string | null;
  preferred_name: string | null;
  page_copy: PageCopyData;
  updated_at: string | null;
};

export const DEFAULT_PAGE_COPY: PageCopyData = {
  memory_subtitle: null,
  diary_subtitle: null,
  task_subtitle: null,
  settings_subtitle: null,
  home_hero_eyebrow: null,
  home_hero_title_mode: "auto",
  home_hero_title: null,
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
