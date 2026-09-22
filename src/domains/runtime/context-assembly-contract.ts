import type {
  SubjectStateKind,
  SubjectStateWrite,
  SubjectStateWriter,
} from "./subject-state-contract.js";

export type ContextItemType =
  | "surface"
  | SubjectStateKind
  | "user_message"
  | "tool_result"
  | "artifact";

export type ContextManifestItem = {
  id: string;
  type: ContextItemType;
  sourceId: string;
  authority: "instruction" | "data";
  trustBoundary:
    | "system"
    | "developer"
    | "user"
    | "tool"
    | "canonical_data"
    | "subject_state_data";
  text?: string | null;
  payload?: Record<string, unknown> | null;
  writer?: SubjectStateWriter | null;
  provenanceSourceIds?: string[];
};

export type InitialContextManifest = {
  conversationId: string;
  pathHeadMessageId: string | null;
  snapshotSequence: number;
  assembledAt: string;
  items: ContextManifestItem[];
};

export type TurnContextDelta = {
  conversationId: string;
  pathHeadMessageId: string | null;
  afterSnapshotSequence: number;
  deltaSequence: number;
  observedAt: string;
  items: ContextManifestItem[];
};

/**
 * Recalled / injected subject state is always data. Recall must never promote a
 * memory, feeling, dream, thought, drive, topic, or bedrock entry into an
 * instruction boundary merely because it was selected for context.
 */
export function subjectStateToContextItem(
  state: SubjectStateWrite,
): ContextManifestItem {
  return {
    id: `subject-state:${state.id}`,
    type: state.kind,
    sourceId: state.id,
    authority: "data",
    trustBoundary: "subject_state_data",
    text: state.text ?? null,
    payload: state.payload ?? null,
    writer: state.writer,
    provenanceSourceIds: state.provenance.sources.map((source) => source.id),
  };
}

export function assertContextManifestSafe(
  manifest: InitialContextManifest | TurnContextDelta,
): void {
  const sequence =
    "snapshotSequence" in manifest
      ? manifest.snapshotSequence
      : manifest.afterSnapshotSequence;

  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error("Context manifest sequence must be a non-negative integer.");
  }

  if (
    "deltaSequence" in manifest
    && (!Number.isInteger(manifest.deltaSequence) || manifest.deltaSequence < 1)
  ) {
    throw new Error("Turn context delta sequence must be a positive integer.");
  }

  for (const item of manifest.items) {
    if (
      item.trustBoundary === "subject_state_data"
      && item.authority !== "data"
    ) {
      throw new Error(
        "Persistent Subject State may enter context only as data authority.",
      );
    }
  }
}
