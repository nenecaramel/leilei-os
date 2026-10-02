import type { NativeLiveRuntimeSessionStoreHealth } from "./types.js";
import {
  requireRecord,
  requireExactKeys,
  NativeLiveRuntimeProtocolError,
  boundedNullableString,
  requireBoundedNonblank,
} from "./parsing.js";

export function parseNativeLiveRuntimeSessionStoreHealth(
  value: unknown,
): NativeLiveRuntimeSessionStoreHealth {
  const body = requireRecord(value);
  requireExactKeys(body, [
    "provider",
    "configured",
    "mode",
    "session_id",
    "parent_session_id",
    "project_key",
    "cwd",
    "parent_local_available",
    "parent_status_before",
    "backfill_status",
    "backfill_failure_reason",
    "mirror_status",
    "mirror_failure_reason",
    "status_after",
    "status_failure_reason",
  ]);

  if (body.provider !== "claude_agent_sdk") {
    throw new NativeLiveRuntimeProtocolError(
      "session_store.provider is invalid.",
    );
  }
  if (typeof body.configured !== "boolean") {
    throw new NativeLiveRuntimeProtocolError(
      "session_store.configured must be boolean.",
    );
  }
  if (
    body.mode !== "new"
    && body.mode !== "resume"
    && body.mode !== "fork"
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "session_store.mode is invalid.",
    );
  }

  const parseStatus = (
    status: unknown,
    field: string,
  ): "complete" | "incomplete" | null => {
    if (status === null) return null;
    if (status !== "complete" && status !== "incomplete") {
      throw new NativeLiveRuntimeProtocolError(
        `session_store.${field} is invalid.`,
      );
    }
    return status;
  };

  if (
    body.parent_local_available !== null
    && typeof body.parent_local_available !== "boolean"
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "session_store.parent_local_available must be boolean or null.",
    );
  }
  if (
    body.backfill_status !== "not_needed"
    && body.backfill_status !== "complete"
    && body.backfill_status !== "failed"
    && body.backfill_status !== "unavailable"
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "session_store.backfill_status is invalid.",
    );
  }
  if (
    body.mirror_status !== "ok"
    && body.mirror_status !== "error"
    && body.mirror_status !== "not_observed"
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "session_store.mirror_status is invalid.",
    );
  }

  return {
    provider: "claude_agent_sdk",
    configured: body.configured,
    mode: body.mode,
    session_id: boundedNullableString(
      body.session_id,
      "session_store.session_id",
      256,
    ),
    parent_session_id: boundedNullableString(
      body.parent_session_id,
      "session_store.parent_session_id",
      256,
    ),
    project_key: requireBoundedNonblank(
      body.project_key,
      "session_store.project_key",
      4_096,
    ),
    cwd: requireBoundedNonblank(
      body.cwd,
      "session_store.cwd",
      4_096,
    ),
    parent_local_available:
      body.parent_local_available as boolean | null,
    parent_status_before: parseStatus(
      body.parent_status_before,
      "parent_status_before",
    ),
    backfill_status: body.backfill_status,
    backfill_failure_reason: boundedNullableString(
      body.backfill_failure_reason,
      "session_store.backfill_failure_reason",
      2_000,
    ),
    mirror_status: body.mirror_status,
    mirror_failure_reason: boundedNullableString(
      body.mirror_failure_reason,
      "session_store.mirror_failure_reason",
      2_000,
    ),
    status_after: parseStatus(
      body.status_after,
      "status_after",
    ),
    status_failure_reason: boundedNullableString(
      body.status_failure_reason,
      "session_store.status_failure_reason",
      2_000,
    ),
  };
}
