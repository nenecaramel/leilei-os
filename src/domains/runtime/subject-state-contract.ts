import {
  validatePersistentWriteEnvelope,
  type PersistentWriteEnvelope,
} from "./persistent-write-envelope.js";

export const CURRENT_SUBJECT_STATE_KINDS = [
  "feel",
  "memory",
  "drive",
  "thought",
  "curiosity",
  "topic",
] as const;

export type CurrentSubjectStateKind =
  (typeof CURRENT_SUBJECT_STATE_KINDS)[number];

export const LEGACY_SUBJECT_STATE_KINDS = ["dream"] as const;

export type LegacySubjectStateKind =
  (typeof LEGACY_SUBJECT_STATE_KINDS)[number];

/**
 * Storage compatibility includes retired kinds so existing persisted rows stay
 * readable until an explicit data migration proves they can be removed.
 * Product/runtime logic that targets current Mind concepts should use
 * CURRENT_SUBJECT_STATE_KINDS instead.
 */
export const SUBJECT_STATE_KINDS = [
  "feel",
  "memory",
  "dream",
  "drive",
  "thought",
  "curiosity",
  "topic",
] as const;

export type SubjectStateKind = (typeof SUBJECT_STATE_KINDS)[number];

export type SubjectStateWrite = {
  id: string;
  kind: SubjectStateKind;
  text?: string | null;
  payload?: Record<string, unknown> | null;
  envelope: PersistentWriteEnvelope;
};

export class SubjectStateContractError extends Error {
  constructor(
    readonly code:
      | "INVALID_ID"
      | "EMPTY_STATE"
      | "UNSETTLED_STATE_MUST_BE_PATH_SCOPED",
    message: string,
  ) {
    super(message);
    this.name = "SubjectStateContractError";
  }
}

function nonBlank(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new SubjectStateContractError("INVALID_ID", `${label} must not be blank.`);
  }
  return normalized;
}

function hasPayload(payload: Record<string, unknown> | null | undefined): boolean {
  return Boolean(payload && Object.keys(payload).length > 0);
}

/**
 * Subject-state semantics sit on top of the generic Persistent Write Envelope.
 * The envelope keeps semantic actor, producer, committer, authority, status
 * axes, scope, provenance and versions separate.
 */
export function validateSubjectStateWrite(
  input: SubjectStateWrite,
): SubjectStateWrite {
  const id = nonBlank(input.id, "id");
  const text = input.text?.trim() || null;

  if (!text && !hasPayload(input.payload)) {
    throw new SubjectStateContractError(
      "EMPTY_STATE",
      "Persistent subject state requires text or a non-empty payload.",
    );
  }

  const envelope = validatePersistentWriteEnvelope(input.envelope);

  if (
    envelope.status.settlementStatus === "unsettled"
    && envelope.scope.applicability !== "path"
  ) {
    throw new SubjectStateContractError(
      "UNSETTLED_STATE_MUST_BE_PATH_SCOPED",
      "Unsettled subject state must remain path-scoped until settlement.",
    );
  }

  return {
    ...input,
    id,
    text,
    envelope,
  };
}
