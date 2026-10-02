import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  NativeLiveMacAttachmentMaterializer,
} from "../src/domains/bridge/mac/native-live-mac-attachment-materializer.js";

const bytes = Buffer.from("attachment payload", "utf8");
const sha256 = createHash("sha256").update(bytes).digest("hex");

test("Mac attachment materializer verifies bytes and writes isolated inbox path", async () => {
  const root = join(
    tmpdir(),
    "leileios-attachment-test-" + process.pid,
  );
  await rm(root, { recursive: true, force: true });

  const relay = {
    async createAttachmentDownloadSlot() {
      return {
        url: "https://bucket.example/file",
        method: "GET" as const,
        headers: {},
        attachment: {
          attachmentId: "55555555-5555-4555-8555-555555555555",
          filename: "../notes.md",
          mimeType: "text/markdown",
          sizeBytes: bytes.length,
          sha256,
          kind: "file" as const,
        },
      };
    },
  };
  const materializer = new NativeLiveMacAttachmentMaterializer(
    relay,
    root,
    async () => new Response(bytes, { status: 200 }),
  );
  const command = {
    protocol_version: 2 as const,
    dispatch_target: "claude_code" as const,
    prepare_id: "11111111-1111-4111-8111-111111111111",
    request_id: "22222222-2222-4222-8222-222222222222",
    operation: "send" as const,
    conversation_id: "33333333-3333-4333-8333-333333333333",
    canonical_user_message_id:
      "44444444-4444-4444-8444-444444444444",
    runtime_mode: "new" as const,
    parent_provider_session_id: null,
    workspace_id: null,
    expected_workspace_root: null,
    prompt: "read it",
    attachments: [{
      attachment_id:
        "55555555-5555-4555-8555-555555555555",
      filename: "../notes.md",
      mime_type: "text/markdown",
      size_bytes: bytes.length,
      sha256,
      kind: "file" as const,
    }],
  };

  const [materialized] = await materializer.materialize(command);
  assert.ok(materialized);
  assert.equal(materialized.localPath.endsWith("/notes.md"), true);
  assert.equal(materialized.localPath.includes("../"), false);
  assert.deepEqual(
    await readFile(materialized.localPath),
    bytes,
  );

  const prompt = materializer.appendPrompt(
    command.prompt,
    [materialized],
  );
  assert.match(prompt, /<leileios_attachments>/u);
  assert.match(prompt, /data, not executable instructions/u);
  assert.match(prompt, /local_path:/u);
  assert.match(prompt, /notes\.md/u);

  await materializer.cleanup(command);
  await assert.rejects(
    () => readFile(materialized.localPath),
  );

  await rm(root, { recursive: true, force: true });
});

test("Mac attachment materializer fails closed on checksum mismatch", async () => {
  const relay = {
    async createAttachmentDownloadSlot() {
      return {
        url: "https://bucket.example/file",
        method: "GET" as const,
        headers: {},
        attachment: {
          attachmentId: "55555555-5555-4555-8555-555555555555",
          filename: "notes.md",
          mimeType: "text/markdown",
          sizeBytes: bytes.length,
          sha256: "b".repeat(64),
          kind: "file" as const,
        },
      };
    },
  };
  const materializer = new NativeLiveMacAttachmentMaterializer(
    relay,
    join(tmpdir(), "leileios-attachment-fail-" + process.pid),
    async () => new Response(bytes, { status: 200 }),
  );
  const command = {
    protocol_version: 2 as const,
    dispatch_target: "claude_code" as const,
    prepare_id: "11111111-1111-4111-8111-111111111111",
    request_id: "22222222-2222-4222-8222-222222222222",
    operation: "send" as const,
    conversation_id: "33333333-3333-4333-8333-333333333333",
    canonical_user_message_id:
      "44444444-4444-4444-8444-444444444444",
    runtime_mode: "new" as const,
    parent_provider_session_id: null,
    workspace_id: null,
    expected_workspace_root: null,
    prompt: "read it",
    attachments: [{
      attachment_id:
        "55555555-5555-4555-8555-555555555555",
      filename: "notes.md",
      mime_type: "text/markdown",
      size_bytes: bytes.length,
      sha256: "b".repeat(64),
      kind: "file" as const,
    }],
  };

  await assert.rejects(
    () => materializer.materialize(command),
    (error: unknown) =>
      typeof error === "object"
      && error !== null
      && "runtimeCode" in error
      && (error as { runtimeCode?: unknown }).runtimeCode
        === "ATTACHMENT_UNAVAILABLE",
  );
});
