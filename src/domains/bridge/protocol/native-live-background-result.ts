import { Buffer } from "node:buffer";
import { requireExactKeys, requireRecord, requireUuid } from "./runtime-protocol/parsing.js";
import { parseNativeLiveRuntimeExecutionResult, type NativeLiveRuntimeExecutionResult } from "./native-live-runtime-protocol.js";
import { normalizeNativeLiveRuntimeEvent } from "../runtime-interaction/native-live-runtime-event-stream.js";

export type NativeLiveBackgroundIdentity = Readonly<{ sourcePrepareId: string; receiptId: string; listenerInstanceId: string; generationId: string }>;
export type NativeLiveBackgroundPrepare = NativeLiveBackgroundIdentity & Readonly<{ parentProviderCheckpointId: string; executionStart?: boolean; deferred?: boolean }>;
export type NativeLiveBackgroundSubmit = NativeLiveBackgroundIdentity & Readonly<{ result: NativeLiveRuntimeExecutionResult; coveringCheckpointId?: string }>;
export type NativeLiveBackgroundPrepared = Readonly<{ receiptId: string; providerSessionId: string; parentProviderCheckpointId: string; expiresAt: string }>;
export type NativeLiveBackgroundAck = Readonly<{ outcome: "committed" | "queued" | "failed" | "stale"; duplicate: boolean; providerCheckpointId: string | null }>;

export class NativeLiveBackgroundResultError extends Error {
  constructor(readonly code: "INVALID_BACKGROUND_RESULT" | "BACKGROUND_CONFLICT" | "BACKGROUND_NOT_FOUND" | "BACKGROUND_UNAVAILABLE") {
    super("Native background result could not be accepted."); this.name = "NativeLiveBackgroundResultError";
  }
}

export function backgroundIdentity(input: NativeLiveBackgroundIdentity): NativeLiveBackgroundIdentity {
  return Object.freeze({ sourcePrepareId: requireUuid(input.sourcePrepareId, "sourcePrepareId"), receiptId: requireUuid(input.receiptId, "receiptId"),
    listenerInstanceId: requireUuid(input.listenerInstanceId, "listenerInstanceId"), generationId: requireUuid(input.generationId, "generationId") });
}

export function backgroundResult(value: unknown): NativeLiveRuntimeExecutionResult {
  try {
    const result = parseNativeLiveRuntimeExecutionResult(structuredClone(value));
    if (result.protocol_version !== 4 || Buffer.byteLength(JSON.stringify(result), "utf8") > 2 * 1024 * 1024) throw Error("bounds");
    if (result.status === "success") {
      if (!result.provider_checkpoint_id || result.output_attachment_ids?.length || result.output_attachment_metadata?.length
        || result.normalized_events.length > 1024) throw Error("unsupported background output");
      return { ...result, normalized_events: result.normalized_events.map(event => {
        const normalized = normalizeNativeLiveRuntimeEvent(event);
        if (normalized.type === "attachment") throw Error("unsupported background attachment");
        if (normalized.provider_session_id && normalized.provider_session_id !== result.provider_session_id) throw Error("foreign session event");
        return normalized;
      }) };
    }
    return result;
  } catch { throw new NativeLiveBackgroundResultError("INVALID_BACKGROUND_RESULT"); }
}

export function parseBackgroundPrepareBody(value: unknown): Omit<NativeLiveBackgroundPrepare, "sourcePrepareId"> {
  const body = requireRecord(value); requireExactKeys(body, ["receipt_id", "listener_instance_id", "generation_id", "parent_provider_checkpoint_id"], ["execution_start", "deferred"]); if (body.execution_start !== undefined && body.execution_start !== true) throw Error("Invalid execution_start"); if (body.deferred !== undefined && body.deferred !== true) throw Error("Invalid deferred");
  return { receiptId: requireUuid(body.receipt_id, "receipt_id"), listenerInstanceId: requireUuid(body.listener_instance_id, "listener_instance_id"),
    generationId: requireUuid(body.generation_id, "generation_id"), parentProviderCheckpointId: requireUuid(body.parent_provider_checkpoint_id, "parent_provider_checkpoint_id"), ...(body.execution_start === true ? { executionStart: true } : {}), ...(body.deferred === true ? { deferred: true } : {}) };
}
export function parseBackgroundSubmitBody(value: unknown): Pick<NativeLiveBackgroundSubmit, "listenerInstanceId" | "generationId" | "result" | "coveringCheckpointId"> {
  const body = requireRecord(value); requireExactKeys(body, ["listener_instance_id", "generation_id", "result"], ["covering_checkpoint_id"]);
  return { listenerInstanceId: requireUuid(body.listener_instance_id, "listener_instance_id"), generationId: requireUuid(body.generation_id, "generation_id"), result: backgroundResult(body.result), ...(body.covering_checkpoint_id === undefined ? {} : { coveringCheckpointId: requireUuid(body.covering_checkpoint_id, "covering_checkpoint_id") }) };
}
