import type { NativeLiveSilenceWakeSchedule } from "../turn/native-live-silence-wake.js";

export function parseAttachmentDescriptor(
  value: unknown,
): {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  kind: "image" | "file";
} {
  const attachment = readRecord(value);
  if (
    typeof attachment.attachmentId !== "string"
    || typeof attachment.filename !== "string"
    || typeof attachment.mimeType !== "string"
    || typeof attachment.sizeBytes !== "number"
    || typeof attachment.sha256 !== "string"
    || (
      attachment.kind !== "image"
      && attachment.kind !== "file"
    )
  ) {
    throw new Error(
      "Native live attachment descriptor is invalid.",
    );
  }
  return {
    attachmentId: attachment.attachmentId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    sha256: attachment.sha256,
    kind: attachment.kind,
  };
}

export function readStringRecord(
  value: unknown,
): Record<string, string> {
  const record = readRecord(value);
  return Object.fromEntries(
    Object.entries(record).map(([key, field]) => {
      if (typeof field !== "string") {
        throw new Error(
          "Native live attachment slot header is invalid.",
        );
      }
      return [key, field];
    }),
  );
}

export function parseSilenceWakeSchedule(
  value: unknown,
): NativeLiveSilenceWakeSchedule {
  const record = readRecord(value);
  if (
    typeof record.epochId !== "string"
    || typeof record.conversationId !== "string"
    || typeof record.postTurnDueAt !== "string"
    || typeof record.longIdleDueAt !== "string"
    || typeof record.postTurnConsumed !== "boolean"
    || typeof record.longIdleConsumed !== "boolean"
    || !Number.isFinite(Date.parse(record.postTurnDueAt))
    || !Number.isFinite(Date.parse(record.longIdleDueAt))
  ) {
    throw new Error(
      "Native live silence wake schedule is invalid.",
    );
  }
  return {
    epochId: record.epochId,
    conversationId: record.conversationId,
    postTurnDueAt: record.postTurnDueAt,
    longIdleDueAt: record.longIdleDueAt,
    postTurnConsumed: record.postTurnConsumed,
    longIdleConsumed: record.longIdleConsumed,
  };
}

export function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Native live relay response is invalid.");
  }
  return value as Record<string, unknown>;
}

export function abortedInteractionError(): Error {
  return Object.assign(
    new Error("Native live runtime interaction was aborted."),
    { runtimeCode: "ABORTED" },
  );
}

export function isAbortedInteraction(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "runtimeCode" in error
    && (error as { runtimeCode?: unknown }).runtimeCode === "ABORTED"
  );
}

export function isRelayPayloadTooLarge(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "httpStatus" in error
    && (error as { httpStatus?: unknown }).httpStatus === 413,
  );
}
