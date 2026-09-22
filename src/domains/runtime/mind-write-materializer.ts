import type {
  SubjectStateWrite,
  SubjectStateWriter,
} from "./subject-state-contract.js";
import type { MindWriteIntent } from "./mind-intent-parser.js";

export type MaterializeMindWritesInput = {
  userId: string;
  conversationId: string;
  assistantMessageId: string;
  intents: readonly MindWriteIntent[];
  createId: () => string;
  writerId: string;
  ruleVersion: string;
  processVersion: string;
  visibility: SubjectStateWrite["scope"]["visibility"];
  sensitivity: SubjectStateWrite["scope"]["sensitivity"];
  model?: SubjectStateWrite["provenance"]["model"];
};

const SUBJECT_WRITER: Pick<SubjectStateWriter, "actor" | "authority"> = {
  actor: "subject",
  authority: "subject_authorized",
};

/**
 * Converts explicit <feel>/<memory>/<dream>/<thought> output into provisional
 * Persistent Subject State tied to the exact assistant path head that produced
 * it. Settlement is a later canonical-path decision.
 */
export function materializeMindWrites(
  input: MaterializeMindWritesInput,
): SubjectStateWrite[] {
  return input.intents.map((intent) => ({
    id: input.createId(),
    kind: intent.kind,
    text: intent.text,
    payload: {
      source_start: intent.sourceStart,
      source_end: intent.sourceEnd,
    },
    lifecycle: "provisional",
    sourceSettlement: "presented",
    writer: {
      ...SUBJECT_WRITER,
      writerId: input.writerId,
    },
    scope: {
      userId: input.userId,
      applicability: "path",
      conversationId: input.conversationId,
      pathHeadMessageId: input.assistantMessageId,
      visibility: input.visibility,
      sensitivity: input.sensitivity,
    },
    provenance: {
      sources: [{ kind: "message", id: input.assistantMessageId }],
      causedBy: input.assistantMessageId,
      derivedFromStateIds: [],
      decisionId: null,
      processRunId: null,
      schemaVersion: 1,
      ruleVersion: input.ruleVersion,
      processVersion: input.processVersion,
      model: input.model ?? null,
    },
  }));
}
