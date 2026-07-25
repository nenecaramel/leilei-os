import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import {
  createReadSettingsApiHandler,
  createResetSettingsApiHandler,
  createSaveSettingsApiHandler,
} from "../src/web-api/settings-router.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";

function responseRecorder() {
  const result: { status?: number; body?: unknown } = {};

  const response = {
    status: (status: number) => {
      result.status = status;
      return response;
    },
    json: (body: unknown) => {
      result.body = body;
      return response;
    },
  } as unknown as Response;

  return { result, response };
}

test("settings api reads settings for authenticated user", async () => {
  const calls: unknown[] = [];

  const handler = createReadSettingsApiHandler({
    settingsService: {
      async readSettings(input) {
        calls.push(input);

        return {
          accent_color: "#405f4d",
          home_title: "蕾蕾的生活系统",
          home_subtitle: "记录、整理与前进",
          preferred_name: "蕾蕾",
          updated_at: "2026-07-25T08:00:00.000Z",
        };
      },

      async saveSettings() {
        throw new Error("Not used in this test.");
      },

      async resetSettings() {
        throw new Error("Not used in this test.");
      },
    },
  });

  const request = {
    webUserId: USER_ID,
  } as Request;

  const { result, response } = responseRecorder();

  await handler(request, response, () => {});

  assert.deepEqual(calls, [
    {
      userId: USER_ID,
    },
  ]);

  assert.deepEqual(result.body, {
    success: true,
    data: {
      accent_color: "#405f4d",
      home_title: "蕾蕾的生活系统",
      home_subtitle: "记录、整理与前进",
      preferred_name: "蕾蕾",
      updated_at: "2026-07-25T08:00:00.000Z",
    },
  });
});

test("settings api saves settings for authenticated user", async () => {
  const calls: unknown[] = [];

  const handler = createSaveSettingsApiHandler({
    settingsService: {
      async readSettings() {
        throw new Error("Not used in this test.");
      },

      async saveSettings(input) {
        calls.push(input);

        return {
          accent_color: input.accentColor,
          home_title: input.homeTitle ?? null,
          home_subtitle: input.homeSubtitle ?? null,
          preferred_name: input.preferredName ?? null,
          updated_at: "2026-07-25T08:30:00.000Z",
        };
      },

      async resetSettings() {
        throw new Error("Not used in this test.");
      },
    },
  });

  const request = {
    webUserId: USER_ID,
    body: {
      accent_color: "#d7a928",
      home_title: "欢迎回家",
      home_subtitle: "这里保存蕾蕾的生活",
      preferred_name: "蕾蕾",
    },
  } as Request;

  const { result, response } = responseRecorder();

  await handler(request, response, () => {});

  assert.deepEqual(calls, [
    {
      userId: USER_ID,
      accentColor: "#d7a928",
      homeTitle: "欢迎回家",
      homeSubtitle: "这里保存蕾蕾的生活",
      preferredName: "蕾蕾",
    },
  ]);

  assert.deepEqual(result.body, {
    success: true,
    data: {
      accent_color: "#d7a928",
      home_title: "欢迎回家",
      home_subtitle: "这里保存蕾蕾的生活",
      preferred_name: "蕾蕾",
      updated_at: "2026-07-25T08:30:00.000Z",
    },
  });
});

test("settings api resets settings for authenticated user", async () => {
  const calls: string[] = [];

  const handler = createResetSettingsApiHandler({
    settingsService: {
      async readSettings() {
        throw new Error("Not used in this test.");
      },

      async saveSettings() {
        throw new Error("Not used in this test.");
      },

      async resetSettings(userId) {
        calls.push(userId);

        return {
          accent_color: "#405f4d",
          home_title: null,
          home_subtitle: null,
          preferred_name: null,
          updated_at: null,
        };
      },
    },
  });

  const request = {
    webUserId: USER_ID,
  } as Request;

  const { result, response } = responseRecorder();

  await handler(request, response, () => {});

  assert.deepEqual(calls, [USER_ID]);

  assert.deepEqual(result.body, {
    success: true,
    data: {
      accent_color: "#405f4d",
      home_title: null,
      home_subtitle: null,
      preferred_name: null,
      updated_at: null,
    },
  });
});

test("settings api rejects unauthenticated requests", async () => {
  const handler = createReadSettingsApiHandler({
    settingsService: {
      async readSettings() {
        throw new Error("Service must not be called.");
      },

      async saveSettings() {
        throw new Error("Service must not be called.");
      },

      async resetSettings() {
        throw new Error("Service must not be called.");
      },
    },
  });

  const request = {} as Request;
  const { result, response } = responseRecorder();

  await handler(request, response, () => {});

  assert.equal(result.status, 401);

  assert.deepEqual(result.body, {
    success: false,
    error: {
      code: "UNAUTHORIZED",
      message: "Web API authentication is required.",
    },
  });
});