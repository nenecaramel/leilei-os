import { createHash } from "node:crypto";

export type ContextLineageState = {
  epoch: number;
  seenStateIds: string[];
  thoughtRevision: number;
  thoughtFingerprint: string | null;
};

export type ContextLineageManifest = {
  epoch: number;
  thoughtRevision: number;
  thoughtFingerprint: string;
  thoughtSnapshotEmitted: boolean;
};

export const EMPTY_CONTEXT_LINEAGE_STATE: ContextLineageState = {
  epoch: 0,
  seenStateIds: [],
  thoughtRevision: 0,
  thoughtFingerprint: null,
};

export function normalizeContextLineageState(
  value: ContextLineageState | null | undefined,
): ContextLineageState {
  if (!value) {
    return {
      ...EMPTY_CONTEXT_LINEAGE_STATE,
      seenStateIds: [],
    };
  }
  if (
    !Number.isInteger(value.epoch)
    || value.epoch < 0
    || !Array.isArray(value.seenStateIds)
    || value.seenStateIds.some(
      (stateId) => typeof stateId !== "string" || !stateId.trim(),
    )
    || !Number.isInteger(value.thoughtRevision)
    || value.thoughtRevision < 0
    || (
      value.thoughtFingerprint !== null
      && !/^[0-9a-f]{64}$/u.test(value.thoughtFingerprint)
    )
  ) {
    throw new Error("Context lineage state is invalid.");
  }

  return {
    epoch: value.epoch,
    seenStateIds: [...new Set(value.seenStateIds)],
    thoughtRevision: value.thoughtRevision,
    thoughtFingerprint: value.thoughtFingerprint,
  };
}

export function fingerprintThoughtSnapshot(
  thoughts: readonly { sourceId: string; text?: string | null }[],
): string {
  const serialized = JSON.stringify(
    thoughts.map((thought) => [
      thought.sourceId,
      thought.text ?? null,
    ]),
  );
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}
