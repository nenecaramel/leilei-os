import type { RuntimeStatusAxes } from "./runtime-status-axes.js";
import type { RuntimePrincipal } from "./persistent-write-envelope.js";
import type { SubjectStateWrite } from "./subject-state-contract.js";
import type { MindWriteIntent } from "./mind-intent-parser.js";
import { writeSubjectStateTemporal } from "./subject-state-temporal.js";

export type MaterializeMindWritesInput = {
  userId: string;
  subjectId: string;
  conversationId: string;
  assistantMessageId: string;
  sourceOccurredAt: string;
  intents: readonly MindWriteIntent[];
  createId: () => string;
  producer: RuntimePrincipal;
  committer: RuntimePrincipal;
  sourceStatus: RuntimeStatusAxes;
  ruleVersion: string;
  processVersion: string;
  visibility: SubjectStateWrite["envelope"]["scope"]["visibility"];
  sensitivity: SubjectStateWrite["envelope"]["scope"]["sensitivity"];
  audience: string[];
  model?: SubjectStateWrite["envelope"]["versions"]["model"];
};

/**
 * Converts explicit subject-authored tags into typed state. It does not guess
 * from ordinary prose. The caller supplies the source status axes so this layer
 * does not pretend that "generated", "presented", "current", and "settled" are
 * the same thing.
 */
export function materializeMindWrites(
  input: MaterializeMindWritesInput,
): SubjectStateWrite[] {
  return input.intents.map((intent) => {
    const basePayload = {
      source_start: intent.sourceStart,
      source_end: intent.sourceEnd,
    };
    const payload =
      intent.kind === "memory" || intent.kind === "feel"
        ? writeSubjectStateTemporal(basePayload, {
            occurredAt: input.sourceOccurredAt,
            basis: "source_message",
            sourceMessageId: input.assistantMessageId,
          })
        : basePayload;

    return {
    id: input.createId(),
    kind: intent.kind,
    text: intent.text,
    payload,
    envelope: {
      semanticActor: { kind: "subject", id: input.subjectId },
      producer: input.producer,
      committer: input.committer,
      authority: "subject_authorized",
      scope: {
        userId: input.userId,
        subjectId: input.subjectId,
        applicability: "path",
        conversationId: input.conversationId,
        pathHeadMessageId: input.assistantMessageId,
        visibility: input.visibility,
        sensitivity: input.sensitivity,
        audience: input.audience,
      },
      status: input.sourceStatus,
      provenance: {
        sources: [{ kind: "message", id: input.assistantMessageId }],
        causedBy: input.assistantMessageId,
        derivedFrom: [],
        decisionId: null,
        processRunId: null,
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: input.ruleVersion,
        processVersion: input.processVersion,
        model: input.model ?? null,
      },
    },
  };
  });
}
