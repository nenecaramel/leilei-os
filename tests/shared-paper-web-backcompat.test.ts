import assert from "node:assert/strict";
import test from "node:test";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import { createSharedPaperApi } from "../web/src/pages/shared-paper-api.js";

test("Shared Paper Web API omits content target for old strict backends while preserving title target", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit) {
      calls.push({ path, init });
      return { success: true, data: { paper: {}, edit: {} } } as T;
    },
  };
  const client = createSharedPaperApi(api);

  await client.edit("paper-1", {
    expected_revision: 3,
    author: "G",
    target: "content",
    start: 1,
    end: 2,
    replacement: "正文",
  });
  await client.edit("paper-1", {
    expected_revision: 4,
    author: "G",
    target: "title",
    start: 0,
    end: 1,
    replacement: "标题",
  });

  assert.equal(calls.length, 2);
  const contentBody = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
  assert.equal(contentBody.expected_revision, 3);
  assert.equal("target" in contentBody, false);

  const titleBody = JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>;
  assert.equal(titleBody.expected_revision, 4);
  assert.equal(titleBody.target, "title");
});
