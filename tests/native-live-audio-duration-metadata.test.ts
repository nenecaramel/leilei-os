import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  NativeLiveMacOutputAttachmentSender,
} from "../src/domains/bridge/mac/native-live-mac-output-attachment-sender.js";
import {
  NativeLiveMacRuntimeExecutor,
} from "../src/domains/bridge/mac/native-live-mac-runtime-executor.js";
import {
  parseNativeLiveRuntimeExecutionResult,
} from "../src/domains/bridge/protocol/native-live-runtime-protocol.js";
import {
  DrizzleNativeLiveAttachmentBinding,
} from "../src/domains/bridge/attachment/native-live-attachment-service.js";
import {
  command,
} from "./helpers/native-live-mac-runtime-executor-fixtures.js";

const attachmentId =
  "66666666-6666-4666-8666-666666666666";
const userId =
  "11111111-1111-4111-8111-111111111111";
const messageId =
  "22222222-2222-4222-8222-222222222222";

function relayFor(
  observed: Array<Record<string, unknown>>,
) {
  return {
    async createAttachmentUploadSlot(input: {
      filename: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      kind: "image" | "file";
    }) {
      observed.push(input);
      return {
        attachment: {
          attachmentId,
          ...input,
        },
        upload: {
          url: "https://bucket.example/upload",
          method: "PUT" as const,
          headers: {},
        },
      };
    },
    async completeAttachmentUpload() {
      const input = observed.at(-1)!;
      return {
        attachmentId,
        filename: input.filename as string,
        mimeType: input.mimeType as string,
        sizeBytes: input.sizeBytes as number,
        sha256: input.sha256 as string,
        kind: input.kind as "image" | "file",
      };
    },
  };
}

const uploadFetch: typeof fetch = async () =>
  new Response(null, { status: 200 });

test("Mac output sender probes audio duration without making probe failure fatal", async (t) => {
  const root = await mkdtemp(
    join(tmpdir(), "leileios-audio-duration-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });

  const audioPath = join(workspace, "voice.mp3");
  await writeFile(audioPath, Buffer.from("audio"));
  const observed: Array<Record<string, unknown>> = [];
  let probeCalls = 0;
  const sender = new NativeLiveMacOutputAttachmentSender(
    relayFor(observed),
    uploadFetch,
    20 * 1024 * 1024,
    async (filePath) => {
      probeCalls += 1;
      assert.equal(filePath, audioPath);
      return 3.42;
    },
  );
  const attachment = await sender.sendFile({
    path: "voice.mp3",
    workspaceRoot: workspace,
  });
  assert.equal(probeCalls, 1);
  assert.equal(attachment.mimeType, "audio/mpeg");
  assert.equal(attachment.durationSeconds, 3.42);

  const textPath = join(workspace, "note.txt");
  await writeFile(textPath, "hello");
  const nonAudio = new NativeLiveMacOutputAttachmentSender(
    relayFor([]),
    uploadFetch,
    20 * 1024 * 1024,
    async () => {
      throw new Error("non-audio must not probe");
    },
  );
  assert.equal(
    (await nonAudio.sendFile({
      path: "note.txt",
      workspaceRoot: workspace,
    })).durationSeconds,
    undefined,
  );

  for (const bad of [0, -1, Number.NaN]) {
    const fallback = new NativeLiveMacOutputAttachmentSender(
      relayFor([]),
      uploadFetch,
      20 * 1024 * 1024,
      async () => bad,
    );
    const result = await fallback.sendFile({
      path: "voice.mp3",
      workspaceRoot: workspace,
    });
    assert.equal(result.durationSeconds, undefined);
  }

  const failedProbe = new NativeLiveMacOutputAttachmentSender(
    relayFor([]),
    uploadFetch,
    20 * 1024 * 1024,
    async () => {
      throw new Error("probe failed");
    },
  );
  assert.equal(
    (await failedProbe.sendFile({
      path: "voice.mp3",
      workspaceRoot: workspace,
    })).durationSeconds,
    undefined,
  );
});

test("Mac output sender recognizes common audio MIME types", async (t) => {
  const root = await mkdtemp(
    join(tmpdir(), "leileios-audio-mime-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const expected = new Map([
    [".mp3", "audio/mpeg"],
    [".m4a", "audio/mp4"],
    [".wav", "audio/wav"],
    [".aac", "audio/aac"],
    [".flac", "audio/flac"],
    [".ogg", "audio/ogg"],
    [".opus", "audio/opus"],
  ]);
  for (const [ext, mimeType] of expected) {
    const name = "voice" + ext;
    await writeFile(join(workspace, name), Buffer.from("audio"));
    const sender = new NativeLiveMacOutputAttachmentSender(
      relayFor([]),
      uploadFetch,
      20 * 1024 * 1024,
      async () => 1,
    );
    const result = await sender.sendFile({
      path: name,
      workspaceRoot: workspace,
    });
    assert.equal(result.mimeType, mimeType);
    assert.equal(result.durationSeconds, 1);
  }
});

test("default Mac duration probe uses bounded afinfo execFile without a shell dependency", () => {
  const source = readFileSync(
    "src/domains/bridge/mac/native-live-mac-output-attachment-sender.ts",
    "utf8",
  );
  assert.match(source, /execFile\(/);
  assert.match(source, /"\/usr\/bin\/afinfo"/);
  assert.match(source, /timeout: 2_000/);
  assert.match(
    source,
    /estimated duration:\\s\*\(\[0-9\]/,
  );
  assert.doesNotMatch(source, /ffmpeg|execSync\(|shell:\s*true/u);
});

test("runtime result round-trips output audio duration metadata", async () => {
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn(
      _prompt: string,
      options: {
        sendFileHandler?: (input: {
          path: string;
          displayName: string | null;
        }) => Promise<{
          attachmentId: string;
          filename: string;
          mimeType: string;
          sizeBytes: number;
          sha256: string;
          kind: "image" | "file";
          durationSeconds?: number;
        }>;
      },
    ) {
      await options.sendFileHandler!({
        path: "voice.m4a",
        displayName: null,
      });
      return {
        providerSessionId: "provider-audio",
        normalizedEvents: [],
      };
    },
  };
  const sender = {
    async sendFile() {
      return {
        attachmentId,
        filename: "voice.m4a",
        mimeType: "audio/mp4",
        sizeBytes: 123,
        sha256: "a".repeat(64),
        kind: "file" as const,
        durationSeconds: 3.42,
      };
    },
  };
  const result = await new NativeLiveMacRuntimeExecutor(
    runtime,
    "/workspace",
    null,
    sender,
  ).execute(command({ protocol_version: 3 }));
  assert.equal(result.status, "success");
  if (result.status !== "success") {
    throw new Error("expected success");
  }
  assert.deepEqual(result.output_attachment_ids, [attachmentId]);
  assert.deepEqual(result.output_attachment_metadata, [{
    attachment_id: attachmentId,
    duration_seconds: 3.42,
  }]);

  const parsed = parseNativeLiveRuntimeExecutionResult(result);
  assert.equal(parsed.status, "success");
  if (parsed.status !== "success") {
    throw new Error("expected parsed success");
  }
  assert.deepEqual(
    parsed.output_attachment_metadata,
    result.output_attachment_metadata,
  );
});

test("runtime protocol keeps duration metadata optional and rejects unsafe metadata", () => {
  const base = {
    protocol_version: 3 as const,
    prepare_id: "11111111-1111-4111-8111-111111111111",
    request_id: "22222222-2222-4222-8222-222222222222",
    conversation_id: "33333333-3333-4333-8333-333333333333",
    status: "success" as const,
    provider_session_id: "provider",
    normalized_events: [],
    output_attachment_ids: [attachmentId],
  };
  const legacy = parseNativeLiveRuntimeExecutionResult(base);
  assert.equal(legacy.status, "success");
  if (legacy.status !== "success") throw new Error("expected success");
  assert.equal(legacy.output_attachment_metadata, undefined);

  assert.throws(
    () => parseNativeLiveRuntimeExecutionResult({
      ...base,
      output_attachment_metadata: [{
        attachment_id:
          "77777777-7777-4777-8777-777777777777",
        duration_seconds: 3.42,
      }],
    }),
    /must belong to output_attachment_ids/u,
  );

  for (const duration of [
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.throws(
      () => parseNativeLiveRuntimeExecutionResult({
        ...base,
        output_attachment_metadata: [{
          attachment_id: attachmentId,
          duration_seconds: duration,
        }],
      }),
      /finite and positive/u,
    );
  }

  assert.throws(
    () => parseNativeLiveRuntimeExecutionResult({
      ...base,
      output_attachment_metadata: [{
        attachment_id: attachmentId,
        duration_seconds: 3.42,
        raw_probe_output: "forbidden",
      }],
    }),
    /Unexpected runtime protocol field/u,
  );
});

function bindingDb(
  mimeType = "audio/mp4",
) {
  const row = {
    id: attachmentId,
    userId,
    objectKey: "native-live/user/audio",
    content: null,
    filename: "voice.m4a",
    mimeType,
    sizeBytes: 123,
    sha256: "a".repeat(64),
    kind: "file" as const,
    status: "ready" as const,
    boundMessageId: null,
    createdAt: new Date("2026-10-06T00:00:00.000Z"),
    updatedAt: new Date("2026-10-06T00:00:00.000Z"),
    readyAt: new Date("2026-10-06T00:00:00.000Z"),
    boundAt: null,
    failedAt: null,
    expiresAt: new Date("2099-10-07T00:00:00.000Z"),
  };
  const inserts: unknown[] = [];
  const db = {
    select() {
      return {
        from() {
          return {
            async where() {
              return [row];
            },
          };
        },
      };
    },
    update() {
      return {
        set() {
          return {
            where() {
              return {
                async returning() {
                  return [{ id: row.id }];
                },
              };
            },
          };
        },
      };
    },
    insert() {
      return {
        async values(value: unknown) {
          inserts.push(value);
        },
      };
    },
  };
  return { db, inserts };
}

test("binding mirrors valid duration into both canonical attachment payloads", async () => {
  const withDuration = bindingDb();
  await new DrizzleNativeLiveAttachmentBinding(
    withDuration.db as never,
  ).bindReadyToMessage({
    userId,
    messageId,
    attachmentIds: [attachmentId],
    attachmentMetadata: [{
      attachment_id: attachmentId,
      duration_seconds: 3.42,
    }],
    contentOrigin: "provider_send",
  });
  const relationRows =
    withDuration.inserts[0] as Array<{
      payload: Record<string, unknown>;
    }>;
  const blockRows =
    withDuration.inserts[1] as Array<{
      payload: Record<string, unknown>;
    }>;
  assert.equal(
    relationRows[0].payload.duration_seconds,
    3.42,
  );
  assert.equal(
    blockRows[0].payload.duration_seconds,
    3.42,
  );
  assert.equal(blockRows[0].payload.mime_type, "audio/mp4");

  const historical = bindingDb();
  await new DrizzleNativeLiveAttachmentBinding(
    historical.db as never,
  ).bindReadyToMessage({
    userId,
    messageId,
    attachmentIds: [attachmentId],
    contentOrigin: "provider_send",
  });
  const historicalRelations =
    historical.inserts[0] as Array<{
      payload: Record<string, unknown>;
    }>;
  const historicalBlocks =
    historical.inserts[1] as Array<{
      payload: Record<string, unknown>;
    }>;
  assert.equal(
    "duration_seconds" in historicalRelations[0].payload,
    false,
  );
  assert.equal(
    "duration_seconds" in historicalBlocks[0].payload,
    false,
  );

  const nonAudio = bindingDb("application/pdf");
  await new DrizzleNativeLiveAttachmentBinding(
    nonAudio.db as never,
  ).bindReadyToMessage({
    userId,
    messageId,
    attachmentIds: [attachmentId],
    attachmentMetadata: [{
      attachment_id: attachmentId,
      duration_seconds: 3.42,
    }],
  });
  const nonAudioBlocks =
    nonAudio.inserts[1] as Array<{
      payload: Record<string, unknown>;
    }>;
  assert.equal(
    "duration_seconds" in nonAudioBlocks[0].payload,
    false,
  );

  const invalid = bindingDb();
  await new DrizzleNativeLiveAttachmentBinding(
    invalid.db as never,
  ).bindReadyToMessage({
    userId,
    messageId,
    attachmentIds: [attachmentId],
    attachmentMetadata: [
      {
        attachment_id: attachmentId,
        duration_seconds: 0,
      },
      {
        attachment_id:
          "77777777-7777-4777-8777-777777777777",
        duration_seconds: 9,
      },
    ],
  });
  const invalidBlocks =
    invalid.inserts[1] as Array<{
      payload: Record<string, unknown>;
    }>;
  assert.equal(
    "duration_seconds" in invalidBlocks[0].payload,
    false,
  );
});

test("legacy results without output metadata preserve the old finalize hash shape", () => {
  const coordinator = readFileSync(
    "src/domains/bridge/turn/native-live-backend-turn-coordinator.ts",
    "utf8",
  );
  const finalize = readFileSync(
    "src/domains/bridge/turn/turn-repository/finalize-success.ts",
    "utf8",
  );
  assert.match(
    coordinator,
    /result\.output_attachment_metadata === undefined[\s\S]*\? \{\}[\s\S]*outputAttachmentMetadata/,
  );
  assert.match(
    finalize,
    /input\.outputAttachmentMetadata\?\.length[\s\S]*outputAttachmentMetadata/,
  );
});

test("iOS reads finite positive metadata and prefers playback duration when available", () => {
  const media = readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMediaPresentation.swift",
    "utf8",
  );
  const bubble = readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveAudioAttachmentBubble.swift",
    "utf8",
  );
  assert.match(
    media,
    /var durationSeconds: TimeInterval\?[\s\S]*metadata\["duration_seconds"\]\?\.numberValue[\s\S]*value\.isFinite, value > 0/,
  );
  assert.match(
    bubble,
    /private var effectiveDuration: TimeInterval\?[\s\S]*playback\.duration\.isFinite, playback\.duration > 0[\s\S]*return playback\.duration[\s\S]*return input\.durationSeconds/,
  );
  assert.match(
    bubble,
    /audioWidth\(duration: effectiveDuration \?\? 0, sizeBytes: input\.sizeBytes/,
  );
  assert.match(
    bubble,
    /guard let duration = effectiveDuration else \{ return "—" \}/,
  );
  assert.doesNotMatch(
    bubble,
    /durationLabel\(seconds: NativeLiveVoiceBubbleGeometry\.audioSeconds/,
  );
});
