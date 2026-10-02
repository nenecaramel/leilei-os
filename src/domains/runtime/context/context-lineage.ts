import { createHash } from "node:crypto";

export type ContextLineageState = {
  epoch: number;
  seenStateIds: string[];
  thoughtRevision: number;
  thoughtFingerprint: string | null;
  /**
   * Transient bootstrap hint for a provider checkpoint that predates lineage
   * persistence. It is never stored in runtime_context_lineage_states.
   */
  forceThoughtSnapshot?: boolean;
};

export type ContextLineageManifest = {
  epoch: number;
  thoughtRevision: number;
  thoughtFingerprint: string;
  thoughtSnapshotEmitted: boolean;
  activeThoughtCount: number;
  thoughtRefs: Array<{
    alias: string;
    stateId: string;
  }>;
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
    || (
      value.forceThoughtSnapshot !== undefined
      && typeof value.forceThoughtSnapshot !== "boolean"
    )
  ) {
    throw new Error("Context lineage state is invalid.");
  }

  return {
    epoch: value.epoch,
    seenStateIds: [...new Set(value.seenStateIds)],
    thoughtRevision: value.thoughtRevision,
    thoughtFingerprint: value.thoughtFingerprint,
    ...(value.forceThoughtSnapshot ? { forceThoughtSnapshot: true } : {}),
  };
}


export function parseContextLineageManifest(
  value: unknown,
): ContextLineageManifest | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Context lineage manifest metadata is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (
    !Number.isInteger(record.epoch)
    || (record.epoch as number) < 0
    || !Number.isInteger(record.thoughtRevision)
    || (record.thoughtRevision as number) < 0
    || typeof record.thoughtFingerprint !== "string"
    || !/^[0-9a-f]{64}$/u.test(record.thoughtFingerprint)
    || typeof record.thoughtSnapshotEmitted !== "boolean"
    || !Number.isInteger(record.activeThoughtCount)
    || (record.activeThoughtCount as number) < 0
    || !Array.isArray(record.thoughtRefs)
    || record.thoughtRefs.some((value) =>
      !value
      || typeof value !== "object"
      || Array.isArray(value)
      || typeof (value as Record<string, unknown>).alias !== "string"
      || !/^T[1-9][0-9]?$/u.test(
        (value as Record<string, unknown>).alias as string,
      )
      || typeof (value as Record<string, unknown>).stateId !== "string"
      || !((value as Record<string, unknown>).stateId as string).trim()
    )
    || record.thoughtRefs.length !== record.activeThoughtCount
  ) {
    throw new Error("Context lineage manifest metadata is invalid.");
  }

  const thoughtRefs =
    (record.thoughtRefs as Array<Record<string, unknown>>)
      .map((value) => ({
        alias: value.alias as string,
        stateId: value.stateId as string,
      }));
  if (
    new Set(thoughtRefs.map((value) => value.alias)).size
      !== thoughtRefs.length
    || new Set(thoughtRefs.map((value) => value.stateId)).size
      !== thoughtRefs.length
  ) {
    throw new Error("Context lineage Thought refs must be unique.");
  }
  if (
    thoughtRefs.some(
      (value, index) => value.alias !== `T${index + 1}`,
    )
  ) {
    throw new Error(
      "Context lineage Thought refs must use contiguous T1..Tn aliases.",
    );
  }

  return {
    epoch: record.epoch as number,
    thoughtRevision: record.thoughtRevision as number,
    thoughtFingerprint: record.thoughtFingerprint,
    thoughtSnapshotEmitted: record.thoughtSnapshotEmitted,
    activeThoughtCount: record.activeThoughtCount as number,
    thoughtRefs,
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
