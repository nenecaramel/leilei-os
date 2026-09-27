import type { RuntimeStatusAxes } from "./runtime-status-axes.js";

export type RuntimePrincipal = {
  kind: "subject" | "user" | "process" | "model" | "runtime" | "service" | "migration";
  id: string;
};

export type PersistentAuthority =
  | "subject_authorized"
  | "user_asserted"
  | "derived"
  | "system_generated";

export type PersistentScope = {
  userId: string;
  subjectId: string;
  applicability: "global" | "conversation" | "path";
  conversationId?: string | null;
  pathHeadMessageId?: string | null;
  visibility: "subject_private" | "user_visible" | "shared" | "hidden_system";
  sensitivity: "normal" | "sensitive";
  audience: string[];
};

export type PersistentSourceRef = {
  kind:
    | "ledger_event"
    | "message"
    | "tool_result"
    | "artifact"
    | "decision"
    | "persistent_state"
    | "manual_entry";
  id: string;
};

export type PersistentProvenance = {
  sources: PersistentSourceRef[];
  parentId?: string | null;
  causedBy?: string | null;
  derivedFrom?: string[];
  decisionId?: string | null;
  processRunId?: string | null;
};

export type PersistentVersions = {
  schemaVersion: number;
  ruleVersion: string;
  processVersion: string;
  model?: {
    provider: string;
    model: string;
    configVersion?: string | null;
    promptContractVersion?: string | null;
  } | null;
};

export type PersistentWriteEnvelope = {
  semanticActor: RuntimePrincipal;
  producer: RuntimePrincipal;
  committer: RuntimePrincipal;
  authority: PersistentAuthority;
  scope: PersistentScope;
  status: RuntimeStatusAxes;
  provenance: PersistentProvenance;
  versions: PersistentVersions;
};

function nonBlank(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must not be blank.`);
}

export function validatePersistentWriteEnvelope(
  envelope: PersistentWriteEnvelope,
): PersistentWriteEnvelope {
  for (const [label, principal] of [
    ["semanticActor", envelope.semanticActor],
    ["producer", envelope.producer],
    ["committer", envelope.committer],
  ] as const) {
    nonBlank(principal.id, `${label}.id`);
  }

  nonBlank(envelope.scope.userId, "scope.userId");
  nonBlank(envelope.scope.subjectId, "scope.subjectId");

  if (
    envelope.scope.applicability === "conversation"
    && !envelope.scope.conversationId
  ) {
    throw new Error("Conversation-scoped write requires conversationId.");
  }
  if (
    envelope.scope.applicability === "path"
    && (!envelope.scope.conversationId || !envelope.scope.pathHeadMessageId)
  ) {
    throw new Error(
      "Path-scoped write requires conversationId and pathHeadMessageId.",
    );
  }

  if (envelope.provenance.sources.length === 0) {
    throw new Error("Persistent write requires at least one provenance source.");
  }
  for (const source of envelope.provenance.sources) {
    nonBlank(source.id, "provenance source id");
  }

  if (
    !Number.isInteger(envelope.versions.schemaVersion)
    || envelope.versions.schemaVersion < 1
    || !envelope.versions.ruleVersion.trim()
    || !envelope.versions.processVersion.trim()
  ) {
    throw new Error(
      "Persistent write requires positive schemaVersion plus ruleVersion and processVersion.",
    );
  }

  return envelope;
}
