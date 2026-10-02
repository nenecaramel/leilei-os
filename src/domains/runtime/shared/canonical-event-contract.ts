export type CanonicalEventTime = {
  occurredAt: string | null;
  observedAt: string;
  recordedAt: string;
  effectiveAt: string;
};

export type CanonicalEventRelation = {
  parentEventId?: string | null;
  causedBy?: string | null;
  derivedFrom?: string[];
  decisionId?: string | null;
};

export type CanonicalEventEnvelope = {
  eventId: string;
  userId: string;
  subjectId: string;
  streamId: string;
  streamSequence: number;
  eventType: string;
  schemaVersion: number;
  time: CanonicalEventTime;
  relation: CanonicalEventRelation;
  payload: Record<string, unknown>;
};

export type CanonicalCorrectionKind =
  | "correct"
  | "supersede"
  | "retract"
  | "tombstone";

export type CanonicalCorrectionEvent = CanonicalEventEnvelope & {
  eventType: "canonical_correction";
  payload: {
    targetEventId: string;
    kind: CanonicalCorrectionKind;
    reason: string;
  };
};

export function validateCanonicalEvent(
  event: CanonicalEventEnvelope,
): CanonicalEventEnvelope {
  if (!event.eventId.trim() || !event.userId.trim() || !event.subjectId.trim()) {
    throw new Error("Canonical event identity fields must not be blank.");
  }
  if (!event.streamId.trim() || !event.eventType.trim()) {
    throw new Error("Canonical event stream and type must not be blank.");
  }
  if (!Number.isInteger(event.streamSequence) || event.streamSequence < 0) {
    throw new Error("Canonical event streamSequence must be a non-negative integer.");
  }
  if (!Number.isInteger(event.schemaVersion) || event.schemaVersion < 1) {
    throw new Error("Canonical event schemaVersion must be positive.");
  }
  return event;
}
