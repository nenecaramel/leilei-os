import { createHash } from "node:crypto";
import type { NativeLiveMessage } from "../../../conversation/native-live-conversation-types.js";
import type {
  NativeLivePreparedTurn,
  NativeLivePreparePortResult,
} from "../native-live-backend-turn-coordinator.js";
import { parseNativeLiveExecutionSelection } from "../native-live-execution-selection.js";
import type { NativeLiveRuntimeAttachment } from "../../attachment/native-live-attachment-service.js";
import type { PreparationRow } from "./types.js";

export const REQUEST_HASH_VERSION = "leileios:native-live-turn-request:v1";

export const RESULT_HASH_VERSION = "leileios:native-live-turn-result:v1";

export function hashJson(version: string, value: unknown): string {
  return createHash("sha256")
    .update(`${version}\n${JSON.stringify(value)}`, "utf8")
    .digest("hex");
}

export function mapPreparation(row: PreparationRow): NativeLivePreparedTurn {
  return {
    prepareId: row.id,
    requestId: row.requestId,
    userId: row.userId,
    conversationId: row.conversationId,
    operation: row.operation,
    canonicalUserMessageId: row.canonicalUserMessageId,
    replacementTargetUserMessageId: row.replacementTargetUserMessageId,
    wakeContext: row.wakeContext,
    runtimeMode: row.runtimeMode,
    parentProviderSessionId: row.parentProviderSessionId,
    workspaceId: row.workspaceId,
    expectedWorkspaceRoot: row.expectedWorkspaceRoot,
    executionSelection: row.executionSelection === null
      ? null
      : parseNativeLiveExecutionSelection(row.executionSelection),
    attachments: parseStoredAttachments(row.attachments),
    prompt: row.prompt,
    mindPrepared: row.mindPrepared,
  };
}

export function readUserText(message: NativeLiveMessage): string | null {
  const text = message.blocks
    .filter((block) => block.kind === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

export function parseStoredAttachments(
  value: Array<Record<string, unknown>>,
): NativeLiveRuntimeAttachment[] {
  return value.map((item) => {
    const attachmentId = item.attachment_id;
    const filename = item.filename;
    const mimeType = item.mime_type;
    const sizeBytes = item.size_bytes;
    const sha256 = item.sha256;
    const kind = item.kind;
    if (
      typeof attachmentId !== "string"
      || typeof filename !== "string"
      || typeof mimeType !== "string"
      || typeof sizeBytes !== "number"
      || !Number.isSafeInteger(sizeBytes)
      || sizeBytes <= 0
      || typeof sha256 !== "string"
      || !/^[0-9a-f]{64}$/u.test(sha256)
      || (kind !== "image" && kind !== "file")
    ) {
      throw new Error(
        "Stored Native Live attachment descriptor is invalid.",
      );
    }
    return {
      attachment_id: attachmentId,
      filename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      sha256,
      kind,
    };
  });
}

export function requestConflictOrReplay(
  row: PreparationRow,
  requestHash: string,
): NativeLivePreparePortResult {
  if (row.requestHash !== requestHash) {
    return { ok: false, code: "REQUEST_CONFLICT" };
  }
  return {
    ok: true,
    outcome: "replayed",
    preparation: mapPreparation(row),
  };
}
