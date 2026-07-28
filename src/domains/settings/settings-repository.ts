import { eq } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  userSettings,
  type UserPageCopy,
} from "../../database/schema.js";

export type UserSettingsRecord = {
  accentColor: string;
  homeTitle: string | null;
  homeSubtitle: string | null;
  preferredName: string | null;
  timezone: string;
  pageCopy: UserPageCopy;
  updatedAt: Date;
};

export type SaveUserSettingsInput = {
  userId: string;
  accentColor: string;
  homeTitle: string | null;
  homeSubtitle: string | null;
  preferredName: string | null;
  timezone: string;
  pageCopy: UserPageCopy;
};

export interface SettingsRepository {
  findByUserId(
    userId: string,
  ): Promise<UserSettingsRecord | null>;

  save(
    input: SaveUserSettingsInput,
  ): Promise<UserSettingsRecord>;

  reset(userId: string): Promise<void>;
}

type Database = ReturnType<typeof createDatabase>["db"];

export class DrizzleSettingsRepository
  implements SettingsRepository
{
  constructor(private readonly db: Database) {}

  async findByUserId(
    userId: string,
  ): Promise<UserSettingsRecord | null> {
    const [settings] = await this.db
      .select({
        accentColor: userSettings.accentColor,
        homeTitle: userSettings.homeTitle,
        homeSubtitle: userSettings.homeSubtitle,
        preferredName: userSettings.preferredName,
        timezone: userSettings.timezone,
        pageCopy: userSettings.pageCopy,
        updatedAt: userSettings.updatedAt,
      })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    return settings ?? null;
  }

  async save(
    input: SaveUserSettingsInput,
  ): Promise<UserSettingsRecord> {
    const now = new Date();

    const [settings] = await this.db
      .insert(userSettings)
      .values({
        userId: input.userId,
        accentColor: input.accentColor,
        homeTitle: input.homeTitle,
        homeSubtitle: input.homeSubtitle,
        preferredName: input.preferredName,
        timezone: input.timezone,
        pageCopy: input.pageCopy,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          accentColor: input.accentColor,
          homeTitle: input.homeTitle,
          homeSubtitle: input.homeSubtitle,
          preferredName: input.preferredName,
          timezone: input.timezone,
          pageCopy: input.pageCopy,
          updatedAt: now,
        },
      })
      .returning({
        accentColor: userSettings.accentColor,
        homeTitle: userSettings.homeTitle,
        homeSubtitle: userSettings.homeSubtitle,
        preferredName: userSettings.preferredName,
        timezone: userSettings.timezone,
        pageCopy: userSettings.pageCopy,
        updatedAt: userSettings.updatedAt,
      });

    if (!settings) {
      throw new Error("Failed to save user settings.");
    }

    return settings;
  }

  async reset(userId: string): Promise<void> {
    await this.db
      .delete(userSettings)
      .where(eq(userSettings.userId, userId));
  }
}
