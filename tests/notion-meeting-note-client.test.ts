import assert from "node:assert/strict";
import test from "node:test";
import { NotionMeetingNoteClient } from "../src/domains/notion/notion-meeting-note-client.js";
import { NotionTransport } from "../src/domains/notion/notion-transport.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("NotionMeetingNoteClient creates AI meeting notes through the fixed endpoint", async () => {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return jsonResponse({ object: "block", id: "meeting-note-id" });
  };
  const client = new NotionMeetingNoteClient(
    new NotionTransport("ntn_secret_123456789", fakeFetch),
  );

  const result = await client.createMeetingNote({
    source: { type: "file_upload", file_upload_id: "upload-id" },
    parent: { type: "page_id", page_id: "page-id" },
    title: "Weekly sync",
    language: "en",
    options: { kickoff_summary: true },
  });

  assert.equal(result.id, "meeting-note-id");
  assert.deepEqual(calls, [{
    url: "https://api.notion.com/v1/blocks/meeting_notes",
    method: "POST",
    body: {
      source: { type: "file_upload", file_upload_id: "upload-id" },
      parent: { type: "page_id", page_id: "page-id" },
      title: "Weekly sync",
      language: "en",
      options: { kickoff_summary: true },
    },
  }]);
});
