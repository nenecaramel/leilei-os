import { sql } from "drizzle-orm";
import {
  check,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";


export const userStatusEnum = pgEnum("user_status", ["active", "disabled"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    status: userStatusEnum("status").default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("users_email_unique_idx").on(table.email),
    check(
      "users_email_not_blank",
      sql`char_length(btrim(${table.email})) > 0`,
    ),
    check(
      "users_display_name_not_blank",
      sql`char_length(btrim(${table.displayName})) > 0`,
    ),
  ],
);
export type UserPageCopy = {
  diarySubtitle?: string;
  settingsSubtitle?: string;
  homeHeroEyebrow?: string | null;
  homeHeroTitleMode?: "auto" | "custom";
  homeHeroTitle?: string | null;
  homeHeroDescriptionMode?: "auto" | "custom";
  homeHeroDescription?: string | null;
};

export const userSettings = pgTable(
  "user_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),

    accentColor: varchar("accent_color", { length: 7 })
      .default("#405f4d")
      .notNull(),

    homeTitle: varchar("home_title", { length: 120 }),

    homeSubtitle: varchar("home_subtitle", { length: 240 }),

    preferredName: varchar("preferred_name", { length: 80 }),

    timezone: varchar("timezone", { length: 64 })
      .default("Asia/Shanghai")
      .notNull(),

    pageCopy: jsonb("page_copy")
      .$type<UserPageCopy>()
      .default(sql`'{}'::jsonb`)
      .notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("user_settings_user_unique_idx").on(table.userId),

    check(
      "user_settings_accent_color_format",
      sql`${table.accentColor} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),

    check(
      "user_settings_home_title_not_blank",
      sql`${table.homeTitle} IS NULL OR char_length(btrim(${table.homeTitle})) > 0`,
    ),

    check(
      "user_settings_home_subtitle_not_blank",
      sql`${table.homeSubtitle} IS NULL OR char_length(btrim(${table.homeSubtitle})) > 0`,
    ),

    check(
      "user_settings_preferred_name_not_blank",
      sql`${table.preferredName} IS NULL OR char_length(btrim(${table.preferredName})) > 0`,
    ),

    check(
      "user_settings_timezone_not_blank",
      sql`char_length(btrim(${table.timezone})) > 0`,
    ),
  ],
);
