import type {
  PersistentWriteEnvelope,
  RuntimePrincipal,
} from "../shared/persistent-write-envelope.js";
import type { RuntimeStatusAxes } from "../subject-state/runtime-status-axes.js";
import {
  validateSubjectStateWrite,
  type CurrentSubjectStateKind,
  type SubjectStateWrite,
} from "../subject-state/subject-state-contract.js";
import { writeSubjectStateTemporal } from "../subject-state/subject-state-temporal.js";

/**
 * Where a Mind write came from. Both origins end up in `createMindState`, so
 * time, scope, provenance, lifecycle seed and status axes are produced in
 * exactly one place. Adding a field (for example a new temporal version) means
 * changing this file only.
 */
export type MindWriteSource =
  | {
      origin: "assistant";
      conversationId: string;
      assistantMessageId: string;
      /** created_at of the canonical assistant message. */
      occurredAt: string;
      span: { start: number; end: number };
      producer: RuntimePrincipal;
      committer: RuntimePrincipal;
      status: RuntimeStatusAxes;
      visibility: PersistentWriteEnvelope["scope"]["visibility"];
      sensitivity: PersistentWriteEnvelope["scope"]["sensitivity"];
      audience: string[];
      ruleVersion: string;
      processVersion: string;
      model?: PersistentWriteEnvelope["versions"]["model"];
    }
  | {
      origin: "manual";
      /** Explicit user-supplied time of the thing itself; null when unknown. */
      occurredAt: string | null;
      note: string | null;
    };

export function createMindState(input: {
  id: string;
  userId: string;
  subjectId: string;
  kind: CurrentSubjectStateKind;
  text: string;
  source: MindWriteSource;
}): SubjectStateWrite {
  const { source } = input;
  const text = input.text.trim();
  if (!text) {
    throw new Error("A Mind state needs text.");
  }

  let payload: Record<string, unknown>;
  let envelope: PersistentWriteEnvelope;

  if (source.origin === "assistant") {
    payload = writeSubjectStateTemporal(
      {
        source_start: source.span.start,
        source_end: source.span.end,
      },
      {
        occurredAt: source.occurredAt,
        basis: "source_message",
        sourceMessageId: source.assistantMessageId,
      },
    );
    envelope = {
      semanticActor: { kind: "subject", id: input.subjectId },
      producer: source.producer,
      committer: source.committer,
      authority: "subject_authorized",
      scope: {
        userId: input.userId,
        subjectId: input.subjectId,
        applicability: "path",
        conversationId: source.conversationId,
        pathHeadMessageId: source.assistantMessageId,
        visibility: source.visibility,
        sensitivity: source.sensitivity,
        audience: source.audience,
      },
      status: source.status,
      provenance: {
        sources: [{ kind: "message", id: source.assistantMessageId }],
        causedBy: source.assistantMessageId,
        derivedFrom: [],
        decisionId: null,
        processRunId: null,
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: source.ruleVersion,
        processVersion: source.processVersion,
        model: source.model ?? null,
      },
    };
  } else {
    const manualPayload = {
      manual_v1: { occurredAt: source.occurredAt, note: source.note },
    };
    payload =
      source.occurredAt !== null
        ? writeSubjectStateTemporal(manualPayload, {
            occurredAt: source.occurredAt,
            basis: "user_supplied",
            sourceMessageId: null,
          })
        : manualPayload;
    envelope = manualEnvelope({
      id: input.id,
      userId: input.userId,
      subjectId: input.subjectId,
    });
  }

  return validateSubjectStateWrite({
    id: input.id,
    kind: input.kind,
    text,
    payload,
    envelope,
  });
}

function manualEnvelope(input: {
  id: string;
  userId: string;
  subjectId: string;
}): PersistentWriteEnvelope {
  const sourceId = `manual:${input.id}`;
  return {
    semanticActor: { kind: "user", id: input.userId },
    producer: { kind: "user", id: input.userId },
    committer: { kind: "runtime", id: "leileios-runtime" },
    authority: "user_asserted",
    scope: {
      userId: input.userId,
      subjectId: input.subjectId,
      applicability: "global",
      conversationId: null,
      pathHeadMessageId: null,
      visibility: "user_visible",
      sensitivity: "normal",
      audience: [input.subjectId],
    },
    status: {
      generationStatus: "committed",
      presentationStatus: "presented",
      pathStatus: "current",
      settlementStatus: "settled",
      validityStatus: "valid",
    },
    provenance: {
      sources: [{ kind: "manual_entry", id: sourceId }],
      causedBy: sourceId,
      derivedFrom: [],
      decisionId: null,
      processRunId: null,
    },
    versions: {
      schemaVersion: 1,
      ruleVersion: "mind-manual-v1",
      processVersion: "mind-manual-v1",
      model: null,
    },
  };
}
