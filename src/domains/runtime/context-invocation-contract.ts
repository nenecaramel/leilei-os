import type {
  PersistentAuthority,
  RuntimePrincipal,
} from "./persistent-write-envelope.js";
import type { ContextLineageManifest } from "./context-lineage.js";

export type ContextSelection = {
  reason: string;
  rank: number;
  score?: number | null;
  truncated: boolean;
};

export type ContextManifestItem = {
  id: string;
  type: string;
  sourceId: string;
  semanticActor?: RuntimePrincipal | null;
  producer?: RuntimePrincipal | null;
  authority: PersistentAuthority | "instruction" | "data";
  trustBoundary:
    | "system"
    | "developer"
    | "user"
    | "tool"
    | "canonical_data"
    | "subject_state_data";
  text?: string | null;
  payload?: Record<string, unknown> | null;
  /**
   * Turn-local label the model sees instead of `sourceId` (for example T1 for
   * an active thought). Only the manifest can map it back to a real state.
   */
  alias?: string | null;
  selection: ContextSelection;
};

export type ContextBudget = {
  maxItems: number;
  maxChars: number;
  usedItems: number;
  usedChars: number;
  overflowPolicy: "drop_lowest_rank" | "truncate_lowest_rank";
};

export type InitialContextManifest = {
  manifestId: string;
  userId: string;
  subjectId: string;
  conversationId: string;
  pathHeadMessageId: string | null;
  snapshotSequence: number;
  assemblyVersion: string;
  promptContractVersion: string;
  createdAt: string;
  lineage?: ContextLineageManifest | null;
  budget: ContextBudget;
  items: ContextManifestItem[];
};

export type TurnContextDelta = {
  deltaId: string;
  manifestId: string;
  conversationId: string;
  afterSnapshotSequence: number;
  deltaSequence: number;
  observedAt: string;
  items: ContextManifestItem[];
};

export type ModelInvocationRecord = {
  invocationId: string;
  contextManifestId: string;
  modelProvider: string;
  model: string;
  modelConfigVersion: string;
  promptContractVersion: string;
  toolSchemaVersion: string;
  runtimeConfigVersion: string;
  resultStatus: "started" | "succeeded" | "failed" | "aborted";
  startedAt: string;
  completedAt?: string | null;
  failureCode?: string | null;
};

export function assertContextManifestSafe(manifest: InitialContextManifest): void {
  if (!manifest.manifestId.trim() || !manifest.userId.trim() || !manifest.subjectId.trim()) {
    throw new Error("Context manifest identity fields must not be blank.");
  }
  if (!Number.isInteger(manifest.snapshotSequence) || manifest.snapshotSequence < 0) {
    throw new Error("Context manifest snapshotSequence must be non-negative.");
  }
  if (
    manifest.budget.usedItems > manifest.budget.maxItems
    || manifest.budget.usedChars > manifest.budget.maxChars
  ) {
    throw new Error("Context manifest exceeds its declared budget.");
  }
  if (manifest.lineage) {
    if (
      !Number.isInteger(manifest.lineage.epoch)
      || manifest.lineage.epoch < 0
      || !Number.isInteger(manifest.lineage.thoughtRevision)
      || manifest.lineage.thoughtRevision < 0
      || !/^[0-9a-f]{64}$/u.test(manifest.lineage.thoughtFingerprint)
      || !Number.isInteger(manifest.lineage.activeThoughtCount)
      || manifest.lineage.activeThoughtCount < 0
    ) {
      throw new Error("Context manifest lineage metadata is invalid.");
    }
  }
  for (const item of manifest.items) {
    if (
      item.trustBoundary === "subject_state_data"
      && item.authority !== "data"
    ) {
      throw new Error("Subject state may enter context only as data authority.");
    }
    if (!Number.isInteger(item.selection.rank) || item.selection.rank < 0) {
      throw new Error("Context item selection rank must be non-negative.");
    }
  }
}
