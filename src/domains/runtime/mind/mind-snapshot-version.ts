import { createHash } from "node:crypto";
import type { SubjectStateWrite } from "../subject-state/subject-state-contract.js";
import { isConsolidationEligible } from "../subject-state/runtime-status-axes.js";

/** Exact, read-only set of globally recallable records. No hidden/non-settled rows. */
export function snapshotMemories(states: readonly SubjectStateWrite[]): Array<{
  stateId: string;
  text: string;
}> {
  return states.flatMap(state =>
    state.kind === "memory"
    && state.envelope.scope.applicability === "global"
    && state.envelope.scope.visibility !== "hidden_system"
    && isConsolidationEligible(state.envelope.status)
    && typeof state.text === "string" && state.text.trim()
      ? [{stateId: state.id, text: state.text.slice(0, 2_000)}]
      : []
  ).sort((a, b) => a.stateId.localeCompare(b.stateId));
}

/**
 * The server recomputes this from current records before honoring local scores.
 * Includes full original text and lifecycle/status/visibility to reject stale
 * snapshots even when their first 2000 characters haven't changed.
 */
export function mindSnapshotVersion(states: readonly SubjectStateWrite[]): string {
  const eligible = states.filter(state =>
    state.kind === "memory"
    && state.envelope.scope.applicability === "global"
    && state.envelope.scope.visibility !== "hidden_system"
    && isConsolidationEligible(state.envelope.status)
    && typeof state.text === "string" && state.text.trim()
  );
  const data = eligible.map(state => [
    state.id, state.text,
    state.envelope.scope.visibility,
    state.envelope.status,
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}
