import assert from "node:assert/strict";
import test from "node:test";
import {
  NotionApiError,
  NotionTransport,
} from "../src/domains/notion/notion-transport.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("NotionTransport sends fixed API headers and only relative Notion paths", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return jsonResponse({ object: "page", id: "page-id" });
  };
  const transport = new NotionTransport("ntn_secret_123456789", fakeFetch);

  const result = await transport.requestJson("/pages/page-id", {
    method: "PATCH",
    body: JSON.stringify({ in_trash: true }),
  });

  assert.equal(result.id, "page-id");
  assert.equal(calls[0]?.url, "https://api.notion.com/v1/pages/page-id");
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer ntn_secret_123456789");
  assert.equal(headers.get("notion-version"), "2026-03-11");
  assert.equal(headers.get("content-type"), "application/json");

  await assert.rejects(
    () => transport.requestJson("https://evil.example/x"),
    /relative Notion API path/i,
  );
  await assert.rejects(
    () => transport.requestJson("pages/no-leading-slash"),
    /relative Notion API path/i,
  );
});

test("NotionTransport maps stable error codes and never leaks token or upstream body", async () => {
  const cases = [
    [400, "VALIDATION"],
    [401, "AUTHENTICATION_FAILED"],
    [403, "ACCESS_DENIED"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
    [429, "RATE_LIMITED"],
    [500, "UPSTREAM"],
  ] as const;

  for (const [status, expectedCode] of cases) {
    const transport = new NotionTransport(
      "ntn_super_secret_123456",
      async () => new Response("secret upstream payload", { status }),
    );
    await assert.rejects(
      () => transport.requestJson("/search", { method: "POST" }),
      (error: unknown) => {
        assert.ok(error instanceof NotionApiError);
        assert.equal(error.code, expectedCode);
        assert.equal(error.message.includes("ntn_super_secret_123456"), false);
        assert.equal(error.message.includes("secret upstream payload"), false);
        return true;
      },
    );
  }

  const unconfigured = new NotionTransport(undefined, async () => jsonResponse({}));
  await assert.rejects(
    () => unconfigured.requestJson("/search"),
    (error: unknown) => {
      assert.ok(error instanceof NotionApiError);
      assert.equal(error.code, "NOT_CONFIGURED");
      return true;
    },
  );

  const network = new NotionTransport(
    "ntn_secret_123456789",
    async () => { throw new Error("socket failed ntn_secret_123456789"); },
  );
  await assert.rejects(
    () => network.requestJson("/search"),
    (error: unknown) => {
      assert.ok(error instanceof NotionApiError);
      assert.equal(error.code, "UPSTREAM");
      assert.equal(error.message.includes("ntn_secret_123456789"), false);
      return true;
    },
  );
});

test("NotionTransport requestRaw preserves FormData content type ownership", async () => {
  let captured: RequestInit | undefined;
  const fakeFetch: typeof fetch = async (_input, init) => {
    captured = init;
    return jsonResponse({ object: "file_upload", id: "upload-id" });
  };
  const transport = new NotionTransport("ntn_secret_123456789", fakeFetch);
  const form = new FormData();
  form.append("file", new Blob(["hello"], { type: "text/plain" }), "hello.txt");

  const response = await transport.requestRaw("/file_uploads/upload-id/send", {
    method: "POST",
    body: form,
  });

  assert.equal(response.ok, true);
  const headers = new Headers(captured?.headers);
  assert.equal(headers.get("content-type"), null);
  assert.equal(headers.get("authorization"), "Bearer ntn_secret_123456789");
});
