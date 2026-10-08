import { createHash } from "node:crypto";
import {
  readSubjectStateOccurredAt,
  writeSubjectStateTemporal,
} from "../subject-state/subject-state-temporal.js";

/** A content precondition, deliberately independent of Stop/lifecycle updatedAt. */
export function memoryContentVersion(row: {
  text: string | null;
  payload: Record<string, unknown> | null;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([row.text, readSubjectStateOccurredAt(row.payload)]))
    .digest("hex");
}

export function patchMemoryTemporal(
  payload: Record<string, unknown> | null,
  occurredAt: string | null,
): Record<string, unknown> {
  const next = { ...(payload ?? {}) };
  // Keep original envelope provenance; an explicit edited date is user supplied.
  if (occurredAt === null) delete next.temporal_v1;
  else
    Object.assign(
      next,
      writeSubjectStateTemporal(next, {
        occurredAt,
        basis: "user_supplied",
        sourceMessageId: null,
      }),
    );
  const manual = next.manual_v1;
  if (manual && typeof manual === "object" && !Array.isArray(manual)) {
    next.manual_v1 = { ...manual, occurredAt };
  }
  return next;
}
