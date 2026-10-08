import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacRuntimeExecutor,
} from "../src/domains/bridge/mac/native-live-mac-runtime-executor.js";
import {
  command,
} from "./helpers/native-live-mac-runtime-executor-fixtures.js";

test("protocol v4 collects explicit send_file output attachment ids", async () => {
  const attachmentId =
    "66666666-6666-4666-8666-666666666666";
  const sent: unknown[] = [];
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
        }>;
      },
    ) {
      assert.equal(typeof options.sendFileHandler, "function");
      const attachment = await options.sendFileHandler!({
        path: "out/report.pdf",
        displayName: "report.pdf",
      });
      assert.equal(attachment.attachmentId, attachmentId);
      return {
        providerSessionId: "provider-output",
        normalizedEvents: [],
      };
    },
  };
  const sender = {
    async sendFile(input: {
      path: string;
      displayName?: string | null;
      workingDirectory: string;
    }) {
      sent.push(input);
      return {
        attachmentId,
        filename: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 321,
        sha256: "a".repeat(64),
        kind: "file" as const,
      };
    },
  };

  const result =
    await new NativeLiveMacRuntimeExecutor(
      runtime,
      "/workspace",
      null,
      sender,
    ).execute(
      command({ protocol_version: 4 }),
    );

  assert.equal(result.status, "success");
  if (result.status !== "success") {
    throw new Error("expected success");
  }
  assert.deepEqual(sent, [{
    path: "out/report.pdf",
    displayName: "report.pdf",
    workingDirectory: "/workspace",
  }]);
  assert.deepEqual(
    result.output_attachment_ids,
    [attachmentId],
  );
  assert.equal(
    result.output_attachment_metadata,
    undefined,
  );
});


test("retired protocol turns fail before runtime execution", async () => {
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn(
      _prompt: string,
      options: {
        sendFileHandler?: unknown;
      },
    ) {
      assert.equal(options.sendFileHandler, undefined);
      return {
        providerSessionId: "provider-legacy",
        normalizedEvents: [],
      };
    },
  };
  const sender = {
    async sendFile() {
      throw new Error("legacy turn must not send files");
    },
  };

  await assert.rejects(
    new NativeLiveMacRuntimeExecutor(runtime, "/directory", null, sender).execute(command({ protocol_version: 3 })),
    /Unsupported runtime protocol version/,
  );
});
test("protocol v4 preserves the disabled send_file capability", async () => {
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn(
      _prompt: string,
      options: {
        sendFileHandler?: unknown;
      },
    ) {
      assert.equal(options.sendFileHandler, undefined);
      return {
        providerSessionId: "provider-legacy",
        normalizedEvents: [],
      };
    },
  };
  const sender = {
    async sendFile() {
      throw new Error("legacy turn must not send files");
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(runtime, "/directory", null, sender).execute(command({ protocol_version: 4, output_attachments_enabled: false }));
  assert.equal(result.status, "success");
});
