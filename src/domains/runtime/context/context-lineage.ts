export type ContextLineageState = {
  epoch: number;
  seenStateIds: string[];
};
export type ContextLineageManifest = { epoch: number };
export const EMPTY_CONTEXT_LINEAGE_STATE: ContextLineageState = {
  epoch: 0,
  seenStateIds: [],
};

export function normalizeContextLineageState(
  value: ContextLineageState | null | undefined,
): ContextLineageState {
  if (!value) return { epoch: 0, seenStateIds: [] };
  if (
    !Number.isInteger(value.epoch)
    || value.epoch < 0
    || !Array.isArray(value.seenStateIds)
    || value.seenStateIds.some(id => typeof id !== "string" || !id.trim())
  ) {
    throw new Error("Context lineage state is invalid.");
  }
  return { epoch: value.epoch, seenStateIds: [...new Set(value.seenStateIds)] };
}

// Historical manifests may contain additional retired metadata, ignored here.
export function parseContextLineageManifest(
  value: unknown,
): ContextLineageManifest | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Context lineage manifest metadata is invalid.");
  }
  const epoch = (value as ContextLineageManifest).epoch;
  if (!Number.isInteger(epoch) || epoch < 0) {
    throw new Error("Context lineage manifest metadata is invalid.");
  }
  return { epoch };
}
