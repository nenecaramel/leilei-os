import type { SubjectStateWrite } from "../subject-state/subject-state-contract.js";

export type BreathSemanticCandidate = {
  stateId: string;
  kind: SubjectStateWrite["kind"];
  text: string;
};

export interface BreathSemanticScorer {
  score(input: {
    query: string;
    candidates: readonly BreathSemanticCandidate[];
  }): Promise<ReadonlyMap<string, number>>;
}

export function semanticCandidatesFromStates(
  states: readonly SubjectStateWrite[],
): BreathSemanticCandidate[] {
  return states
    .filter(
      (state) =>
        state.kind === "memory"
        && typeof state.text === "string"
        && state.text.trim().length > 0,
    )
    .map((state) => ({
      stateId: state.id,
      kind: state.kind,
      text: state.text!.trim(),
    }));
}
