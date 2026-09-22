export const SUBJECT_STATE_KINDS = [
  "feel",
  "memory",
  "dream",
  "bedrock",
  "drive",
  "thought",
  "curiosity",
  "topic",
] as const;

export type SubjectStateKind = (typeof SUBJECT_STATE_KINDS)[number];

export const SUBJECT_STATE_LIFECYCLES = [
  "provisional",
  "active",
  "superseded",
  "invalidated",
  "archived",
] as const;

export type SubjectStateLifecycle =
  (typeof SUBJECT_STATE_LIFECYCLES)[number];

export const SOURCE_SETTLEMENT_STATES = [
  "current",
  "selected",
  "presented",
  "settled",
  "superseded",
  "rejected",
] as const;

export type SourceSettlementState =
  (typeof SOURCE_SETTLEMENT_STATES)[number];

export type SubjectStateWriter = {
  actor: "subject" | "user" | "process" | "migration";
  writerId: string;
  authority:
    | "subject_authorized"
    | "user_asserted"
    | "derived"
    | "system_generated";
};

export type SubjectStateSourceRef = {
  kind:
    | "ledger_event"
    | "message"
    | "tool_result"
    | "artifact"
    | "decision"
    | "subject_state";
  id: string;
};

export type SubjectStateScope = {
  userId: string;
  applicability: "global" | "conversation" | "branch";
  conversationId?: string | null;
  branchId?: string | null;
  visibility:
    | "subject_private"
    | "user_visible"
    | "shared"
    | "hidden_system";
  sensitivity: "normal" | "sensitive";
};

export type SubjectStateProvenance = {
  sources: SubjectStateSourceRef[];
  causedBy?: string | null;
  derivedFromStateIds?: string[];
  decisionId?: string | null;
  processRunId?: string | null;
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

export type SubjectStateWrite = {
  id: string;
  kind: SubjectStateKind;
  text?: string | null;
  payload?: Record<string, unknown> | null;
  lifecycle: SubjectStateLifecycle;
  sourceSettlement: SourceSettlementState;
  writer: SubjectStateWriter;
  scope: SubjectStateScope;
  provenance: SubjectStateProvenance;
};

export class SubjectStateContractError extends Error {
  constructor(
    readonly code:
      | "INVALID_ID"
      | "EMPTY_STATE"
      | "MISSING_PROVENANCE"
      | "INVALID_VERSION"
      | "BEDROCK_AUTHORITY_REQUIRED"
      | "UNSETTLED_STATE_MUST_BE_PROVISIONAL"
      | "PROVISIONAL_STATE_MUST_BE_BRANCH_SCOPED"
      | "INVALID_SCOPE",
    message: string,
  ) {
    super(message);
    this.name = "SubjectStateContractError";
  }
}

function requireNonBlank(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new SubjectStateContractError("INVALID_ID", `${label} must not be blank.`);
  }
  return normalized;
}

function hasPayload(payload: Record<string, unknown> | null | undefined): boolean {
  return Boolean(payload && Object.keys(payload).length > 0);
}

function validateScope(scope: SubjectStateScope): SubjectStateScope {
  requireNonBlank(scope.userId, "scope.userId");

  if (scope.applicability === "conversation" && !scope.conversationId) {
    throw new SubjectStateContractError(
      "INVALID_SCOPE",
      "Conversation-scoped subject state requires conversationId.",
    );
  }

  if (scope.applicability === "branch") {
    if (!scope.conversationId || !scope.branchId) {
      throw new SubjectStateContractError(
        "INVALID_SCOPE",
        "Branch-scoped subject state requires conversationId and branchId.",
      );
    }
  }

  return scope;
}

/**
 * Persistent Subject State is derived from real experience but is not itself the
 * canonical event history. This validator intentionally enforces only the
 * invariants that are already architecture-level decisions; per-kind write
 * matrices and lifecycle rules remain separate, versioned policy.
 */
export function validateSubjectStateWrite(
  input: SubjectStateWrite,
): SubjectStateWrite {
  const id = requireNonBlank(input.id, "id");
  const writerId = requireNonBlank(input.writer.writerId, "writer.writerId");

  const text = input.text?.trim() || null;
  if (!text && !hasPayload(input.payload)) {
    throw new SubjectStateContractError(
      "EMPTY_STATE",
      "Persistent subject state requires text or a non-empty payload.",
    );
  }

  if (input.provenance.sources.length === 0) {
    throw new SubjectStateContractError(
      "MISSING_PROVENANCE",
      "Persistent subject state requires at least one provenance source.",
    );
  }

  for (const source of input.provenance.sources) {
    requireNonBlank(source.id, "provenance source id");
  }

  if (
    !Number.isInteger(input.provenance.schemaVersion)
    || input.provenance.schemaVersion < 1
    || !input.provenance.ruleVersion.trim()
    || !input.provenance.processVersion.trim()
  ) {
    throw new SubjectStateContractError(
      "INVALID_VERSION",
      "Persistent subject state requires positive schemaVersion plus ruleVersion and processVersion.",
    );
  }

  if (
    input.kind === "bedrock"
    && input.writer.authority !== "subject_authorized"
  ) {
    throw new SubjectStateContractError(
      "BEDROCK_AUTHORITY_REQUIRED",
      "Bedrock writes require subject-authorized authority.",
    );
  }

  if (
    input.sourceSettlement !== "settled"
    && input.lifecycle !== "provisional"
  ) {
    throw new SubjectStateContractError(
      "UNSETTLED_STATE_MUST_BE_PROVISIONAL",
      "State derived from an unsettled source must remain provisional.",
    );
  }

  const scope = validateScope(input.scope);
  if (
    input.lifecycle === "provisional"
    && scope.applicability !== "branch"
  ) {
    throw new SubjectStateContractError(
      "PROVISIONAL_STATE_MUST_BE_BRANCH_SCOPED",
      "Provisional subject state must remain branch-scoped until settlement.",
    );
  }

  return {
    ...input,
    id,
    text,
    writer: {
      ...input.writer,
      writerId,
    },
    scope,
    provenance: {
      ...input.provenance,
      sources: input.provenance.sources.map((source) => ({
        ...source,
        id: source.id.trim(),
      })),
      ruleVersion: input.provenance.ruleVersion.trim(),
      processVersion: input.provenance.processVersion.trim(),
    },
  };
}
