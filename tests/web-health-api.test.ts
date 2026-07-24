import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { createSyncHealthApiHandler } from "../src/web-api/health-router.js";

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

test("health api syncs health data for authenticated user", async () => {
  const calls: unknown[] = [];

  const handler = createSyncHealthApiHandler({
    healthService: {
      async syncHealth(userId, input) {
        calls.push({ userId, input });

        return {
          date: input.date,
          steps: input.steps ?? null,
          periodStartDate: input.periodStartDate ?? null,
          cycleDay: null,
        };
      },
    },
  });

  const request = {
    webUserId: "00000000-0000-4000-8000-000000000099",
    body: {
      date: "2026-07-24",
      steps: 8000,
      periodStartDate: "2026-06-30",
    },
  } as Request;

  const { result, response } = responseRecorder();

  await handler(request, response, () => {});

  assert.deepEqual(calls, [
    {
      userId: "00000000-0000-4000-8000-000000000099",
      input: {
        date: "2026-07-24",
        steps: 8000,
        periodStartDate: "2026-06-30",
      },
    },
  ]);

  assert.deepEqual(result.body, {
    success: true,
    data: {
      date: "2026-07-24",
      steps: 8000,
      periodStartDate: "2026-06-30",
      cycleDay: null,
    },
  });
});