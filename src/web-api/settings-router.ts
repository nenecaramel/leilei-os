import { Router, type RequestHandler } from "express";
import {
  SettingsDomainError,
  type PageCopyInput,
  type SettingsResult,
} from "../domains/settings/settings-service.js";

export type SettingsApiDependencies = {
  settingsService: {
    readSettings(input: {
      userId: string;
    }): Promise<SettingsResult>;

    saveSettings(input: {
      userId: string;
      accentColor: string;
      homeTitle?: string | null;
      homeSubtitle?: string | null;
      preferredName?: string | null;
      timezone?: string;
      pageCopy?: PageCopyInput;
    }): Promise<SettingsResult>;

    resetSettings(
      userId: string,
    ): Promise<SettingsResult>;
  };
};

export function createSettingsApiRouter(
  dependencies: SettingsApiDependencies,
): Router {
  const router = Router();

  router.get(
    "/",
    createReadSettingsApiHandler(dependencies),
  );

  router.patch(
    "/",
    createSaveSettingsApiHandler(dependencies),
  );

  router.delete(
    "/",
    createResetSettingsApiHandler(dependencies),
  );

  return router;
}

export function createReadSettingsApiHandler(
  dependencies: SettingsApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!request.webUserId) {
      response.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message:
            "Web API authentication is required.",
        },
      });
      return;
    }

    try {
      const data =
        await dependencies.settingsService.readSettings({
          userId: request.webUserId,
        });

      response.json({
        success: true,
        data,
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "SETTINGS_UNAVAILABLE",
          message:
            "Settings are temporarily unavailable.",
        },
      });
    }
  };
}

export function createSaveSettingsApiHandler(
  dependencies: SettingsApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!request.webUserId) {
      response.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message:
            "Web API authentication is required.",
        },
      });
      return;
    }

    try {
      const pageCopy = request.body.page_copy;

      const data =
        await dependencies.settingsService.saveSettings({
          userId: request.webUserId,
          accentColor: request.body.accent_color,
          homeTitle: request.body.home_title,
          homeSubtitle: request.body.home_subtitle,
          preferredName: request.body.preferred_name,
          ...(request.body.timezone !== undefined
            ? { timezone: request.body.timezone }
            : {}),
          ...(pageCopy
            ? {
                pageCopy: {
                  memorySubtitle:
                    pageCopy.memory_subtitle,
                  diarySubtitle:
                    pageCopy.diary_subtitle,
                  taskSubtitle:
                    pageCopy.task_subtitle,
                  settingsSubtitle:
                    pageCopy.settings_subtitle,
                  homeHeroEyebrow:
                    pageCopy.home_hero_eyebrow,
                  homeHeroTitleMode:
                    pageCopy.home_hero_title_mode,
                  homeHeroTitle:
                    pageCopy.home_hero_title,
                  homeHeroDescriptionMode:
                    pageCopy.home_hero_description_mode,
                  homeHeroDescription:
                    pageCopy.home_hero_description,
                },
              }
            : {}),
        });

      response.json({
        success: true,
        data,
      });
    } catch (error) {
      if (error instanceof SettingsDomainError) {
        response.status(400).json({
          success: false,
          error: {
            code: "INVALID_SETTINGS",
            message: error.message,
          },
        });
        return;
      }

      response.status(503).json({
        success: false,
        error: {
          code: "SAVE_SETTINGS_FAILED",
          message: "Unable to save settings.",
        },
      });
    }
  };
}

export function createResetSettingsApiHandler(
  dependencies: SettingsApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!request.webUserId) {
      response.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message:
            "Web API authentication is required.",
        },
      });
      return;
    }

    try {
      const data =
        await dependencies.settingsService.resetSettings(
          request.webUserId,
        );

      response.json({
        success: true,
        data,
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "RESET_SETTINGS_FAILED",
          message: "Unable to reset settings.",
        },
      });
    }
  };
}
