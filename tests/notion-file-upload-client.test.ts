import assert from "node:assert/strict";
import test from "node:test";
import { NotionFileUploadClient } from "../src/domains/notion/notion-file-upload-client.js";
import { NotionTransport } from "../src/domains/notion/notion-transport.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("NotionFileUploadClient creates, sends, and completes uploads", async () => {
  const calls: Array<{ url: string; method: string; body?: BodyInit | null }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body });
    return jsonResponse({ object: "file_upload", id: "upload-id", status: "uploaded" });
  };
  const client = new NotionFileUploadClient(
    new NotionTransport("ntn_secret_123456789", fakeFetch),
  );

  await client.createUpload({ mode: "single_part", filename: "hello.txt", content_type: "text/plain" });
  await client.sendUpload(
    "upload id",
    new Blob(["hello"], { type: "text/plain" }),
    "hello.txt",
  );
  await client.sendUpload(
    "upload id",
    new Blob(["part"], { type: "text/plain" }),
    "hello.txt",
    2,
  );
  await client.completeUpload("upload id");

  assert.deepEqual(calls.map(({ url, method }) => [url, method]), [
    ["https://api.notion.com/v1/file_uploads", "POST"],
    ["https://api.notion.com/v1/file_uploads/upload%20id/send", "POST"],
    ["https://api.notion.com/v1/file_uploads/upload%20id/send", "POST"],
    ["https://api.notion.com/v1/file_uploads/upload%20id/complete", "POST"],
  ]);

  assert.ok(calls[1]?.body instanceof FormData);
  const single = calls[1]?.body as FormData;
  assert.equal(single.get("part_number"), null);
  assert.ok(single.get("file") instanceof Blob);
  const multipart = calls[2]?.body as FormData;
  assert.equal(multipart.get("part_number"), "2");
});
