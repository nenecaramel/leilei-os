import type { ContextManifestItem, ContextSelection } from "./context-invocation-contract.js";
import type { SubjectStateWrite } from "../subject-state/subject-state-contract.js";

export type ContextItemType =
  | "surface"
  | SubjectStateWrite["kind"]
  | "user_message"
  | "tool_result"
  | "artifact";

export function subjectStateToContextItem(
  state: SubjectStateWrite,
  selection: ContextSelection,
): ContextManifestItem {
  return {
    id: `subject-state:${state.id}`,
    type: state.kind,
    sourceId: state.id,
    semanticActor: state.envelope.semanticActor,
    producer: state.envelope.producer,
    authority: "data",
    trustBoundary: "subject_state_data",
    text: state.text ?? null,
    payload: state.payload ?? null,
    selection,
  };
}

export {
  assertContextManifestSafe,
  type ContextBudget,
  type ContextManifestItem,
  type ContextSelection,
  type InitialContextManifest,
  type ModelInvocationRecord,
  type TurnContextDelta,
} from "./context-invocation-contract.js";
