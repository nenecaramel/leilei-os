import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createOwnerFingerprint } from "../src/domains/export/owner-fingerprint.js";
import { createWebApiRouter } from "../src/web-api/router.js";

const USER_ID =
  "00000000-0000-4000-8000-000000000099";

const body = JSON.stringify({
  schema_version: 2,
  owner_fingerprint:
    createOwnerFingerprint(USER_ID),
  exported_at: "2026-08-14T00:00:00.000Z",
  data: { diary: [] },
});

function dependencies(importService: {
  preview: (...args: never[]) => Promise<unknown>;
  execute: (...args: never[]) => Promise<unknown>;
}) {
  return {
    diary: { diaryService: {} as never },
    toy: { toyService: {} as never },
    system: { systemService: {} as never },
    globalSearch: { globalSearchService: {} as never },
    todo: { todoService: {} as never },
    export: { exportService: {} as never },
    import: { importService },
    universe: { universeService: {} as never },
  } as never;
}

async function withServer(
  importService: {
    preview: (...args: never[]) => Promise<unknown>;
    execute: (...args: never[]) => Promise<unknown>;
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
    createWebApiRouter(
      dependencies(importService),
    ),
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

test("import preview uses authenticated identity and active-module summary", async () => {
  const calls: unknown[][] = [];
  const summary = {
    diary: {
      create: 1,
      duplicate: 0,
      conflict: 0,
      invalid: 0,
    },
    todo: {
      create: 0,
      duplicate: 0,
      conflict: 0,
      invalid: 0,
    },
  };

  await withServer(
    {
      async preview(...args: never[]) {
        calls.push(args);
        return {
          package_sha256: "a".repeat(64),
          preview_fingerprint: "b".repeat(64),
          summary,
          can_execute: true,
        };
      },
      async execute() {
        throw new Error("unused");
      },
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/v1/system/import/preview`,
        {
          method: "POST",
          headers: {
            "x-test-user": "authenticated",
            "content-type":
              "application/octet-stream",
          },
          body,
        },
      );

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        success: true,
        data: {
          package_sha256: "a".repeat(64),
          preview_fingerprint: "b".repeat(64),
          summary,
          can_execute: true,
        },
      });
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.[1], USER_ID);
});

test("import requires raw octet-stream and authentication", async () => {
  await withServer(
    {
      async preview() {
        throw new Error("must not be called");
      },
      async execute() {
        throw new Error("must not be called");
      },
    },
    async (baseUrl) => {
      const unauthenticated = await fetch(
        `${baseUrl}/api/v1/system/import/preview`,
        {
          method: "POST",
          headers: {
            "content-type":
              "application/octet-stream",
          },
          body,
        },
      );
      assert.equal(
        unauthenticated.status,
        401,
      );

      const wrongContentType = await fetch(
        `${baseUrl}/api/v1/system/import/preview`,
        {
          method: "POST",
          headers: {
            "x-test-user": "authenticated",
            "content-type": "application/json",
          },
          body,
        },
      );
      assert.equal(
        wrongContentType.status,
        400,
      );
    },
  );
});

test("import execute requires the preview fingerprint", async () => {
  await withServer(
    {
      async preview() {
        throw new Error("unused");
      },
      async execute() {
        throw new Error("must not be called");
      },
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/v1/system/import/execute`,
        {
          method: "POST",
          headers: {
            "x-test-user": "authenticated",
            "content-type":
              "application/octet-stream",
          },
          body,
        },
      );
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        success: false,
        error: {
          code: "IMPORT_PREVIEW_STALE",
          message: "Import preview is stale.",
        },
      });
    },
  );
});
