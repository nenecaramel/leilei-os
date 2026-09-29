import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createWebApiRouter } from "../src/web-api/router.js";
import { ExportServiceError } from "../src/domains/export/export-service.js";
import type { ExportDocument } from "../src/domains/export/export-types.js";

const USER_ID =
  "00000000-0000-4000-8000-000000000099";

function documentFor(
  includeAudit: boolean,
): ExportDocument {
  return {
    schema_version: 4,
    owner_fingerprint: "a".repeat(64),
    exported_at: "2026-08-13T05:42:00.000Z",
    data: {
      diary: [],
      diary_comments: [],
      todo: [],
      workspaces: {
        items: [],
        resources: [],
        conversations: [],
      },
      mind: [],
      mind_continuity: {
        drive_satisfaction_events: [],
        curiosity_resolution_events: [],
        distillation_watermarks: [],
        semantic_grouping_results: [],
      },
      conversations: {
        conversations: [],
        messages: [],
        content_blocks: [],
        attachments: [],
        provider_checkpoints: [],
      },
      universe: null,
    },
    ...(includeAudit
      ? { audit: { lifecycle: [], tool_activity: [] } }
      : {}),
  };
}
function dependencies(exportService: {
  createExport: (
    userId: string,
    includeAudit: boolean,
  ) => Promise<ExportDocument>;
}) {
  return {
    diary: { diaryService: {} as never },
    toy: { toyService: {} as never },
    system: { systemService: {} as never },
    globalSearch: { globalSearchService: {} as never },
    todo: { todoService: {} as never },
    export: { exportService },
    import: { importService: {} as never },
    universe: { universeService: {} as never },
  } as never;
}

async function withServer(
  exportService: {
    createExport: (
    userId: string,
    includeAudit: boolean,
  ) => Promise<ExportDocument>;
  },
  callback: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use((request, _response, next) => {
    if (request.header("x-test-user")) {
      request.webUserId = USER_ID;
    }
    next();
  });
  app.use(
    "/api/v1",
    createWebApiRouter(dependencies(exportService)),
  );
  const server =
    await new Promise<import("node:http").Server>(
      (resolve) => {
        const instance = app.listen(
          0,
          () => resolve(instance),
        );
      },
    );
  const address = server.address() as AddressInfo;

  try {
    await callback(
      `http://127.0.0.1:${address.port}`,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) =>
        error ? reject(error) : resolve(),
      ),
    );
  }
}

test("export requires authentication before service access", async () => {
  let calls = 0;

  await withServer(
    {
      async createExport() {
        calls += 1;
        throw new Error("must not be called");
      },
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/v1/system/export`,
      );
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message:
            "Web API authentication is required.",
        },
      });
    },
  );

  assert.equal(calls, 0);
});

test("export creates one full backup and accepts legacy scope=all", async () => {
  const calls: Array<{
    userId: string;
    includeAudit: boolean;
  }> = [];

  await withServer(
    {
      async createExport(userId, includeAudit) {
        calls.push({ userId, includeAudit });
        return documentFor(includeAudit);
      },
    },
    async (baseUrl) => {
      for (const query of [
        "include_audit=true&user_id=attacker",
        "scope=all",
      ]) {
        const response = await fetch(
          `${baseUrl}/api/v1/system/export?${query}`,
          {
            headers: {
              "x-test-user": "authenticated",
            },
          },
        );

        assert.equal(response.status, 200);
        assert.equal(
          response.headers.get("content-disposition"),
          'attachment; filename="leileios-full-backup_20260813T054200Z.json"',
        );
      }
    },
  );

  assert.deepEqual(calls, [
    { userId: USER_ID, includeAudit: true },
    { userId: USER_ID, includeAudit: false },
  ]);
});

test("export rejects partial, repeated, and unknown scopes", async () => {
  await withServer(
    {
      async createExport() {
        throw new Error("must not be called");
      },
    },
    async (baseUrl) => {
      for (const query of [
        "scope=unknown",
        "scope=diary",
        "scope=todo",
        "scope=memory",
        "scope=task",
        "scope=shared_paper",
        "scope=all&scope=all",
        "include_audit=1",
        "include_audit=false&include_audit=true",
      ]) {
        const response = await fetch(
          `${baseUrl}/api/v1/system/export${query ? `?${query}` : ""}`,
          {
            headers: {
              "x-test-user": "authenticated",
            },
          },
        );
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
          success: false,
          error: {
            code: "INVALID_EXPORT_REQUEST",
            message:
              "Export request is invalid.",
          },
        });
      }
    },
  );
});

test("export maps service failures without attachment headers", async () => {
  await withServer(
    {
      async createExport() {
        throw new Error("database failure");
      },
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/v1/system/export`,
        {
          headers: {
            "x-test-user": "authenticated",
          },
        },
      );

      assert.equal(response.status, 503);
      assert.equal(
        response.headers.get(
          "content-disposition",
        ),
        null,
      );
      assert.deepEqual(await response.json(), {
        success: false,
        error: {
          code: "EXPORT_UNAVAILABLE",
          message:
            "Export data is temporarily unavailable.",
        },
      });
    },
  );
});


test("export maps incomplete processing and oversized backups without attachment headers", async () => {
  for (const [error, status, code] of [
    [
      new ExportServiceError("EXPORT_IN_PROGRESS", "prepared_turn"),
      409,
      "EXPORT_IN_PROGRESS",
    ],
    [
      new ExportServiceError("EXPORT_TOO_LARGE"),
      413,
      "EXPORT_TOO_LARGE",
    ],
  ] as const) {
    await withServer(
      {
        async createExport() {
          throw error;
        },
      },
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/v1/system/export`,
          {
            headers: {
              "x-test-user": "authenticated",
            },
          },
        );
        assert.equal(response.status, status);
        assert.equal(
          response.headers.get("content-disposition"),
          null,
        );
        const body = await response.json() as {
          error?: {
            code?: string;
            reason?: string | null;
            message?: string;
          };
        };
        assert.equal(body.error?.code, code);
        if (code === "EXPORT_IN_PROGRESS") {
          assert.equal(body.error?.reason, "prepared_turn");
          assert.equal(
            body.error?.message,
            "A chat turn is still being finalized.",
          );
        }
      },
    );
  }
});
