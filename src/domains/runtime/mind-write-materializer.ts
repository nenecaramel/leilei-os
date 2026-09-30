import type { RuntimeStatusAxes } from "./runtime-status-axes.js";
import type { RuntimePrincipal } from "./persistent-write-envelope.js";
import type { SubjectStateWrite } from "./subject-state-contract.js";
import type { MindWriteIntent } from "./mind-intent-parser.js";
import { createMindState } from "./mind-writer.js";

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
 * the same thing. Everything that shapes the stored state lives in
 * `createMindState`.
 */
export function materializeMindWrites(
  input: MaterializeMindWritesInput,
): SubjectStateWrite[] {
  return input.intents.map((intent) =>
    createMindState({
      id: input.createId(),
      userId: input.userId,
      subjectId: input.subjectId,
      kind: intent.kind,
      text: intent.text,
      source: {
        origin: "assistant",
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        occurredAt: input.sourceOccurredAt,
        span: { start: intent.sourceStart, end: intent.sourceEnd },
        producer: input.producer,
        committer: input.committer,
        status: input.sourceStatus,
        visibility: input.visibility,
        sensitivity: input.sensitivity,
        audience: input.audience,
        ruleVersion: input.ruleVersion,
        processVersion: input.processVersion,
        model: input.model,
      },
    }),
  );
}
