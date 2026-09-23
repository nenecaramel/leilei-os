import type {
  ProactivityWakeDecision,
  ProactivityWakeGateInput,
} from "./proactivity-wake-contract.js";

export type ProactivityWakeStatus =
  | "created"
  | "waiting_model"
  | "decided";

export type ProactivityWakeContextSnapshot = {
  version: 1;
  contextManifestId: string | null;
  capsule: string;
  sourceConversationId?: string | null;
  sourceHeadMessageId?: string | null;
  sourceActivityAt?: string | null;
};

export type ProactivityWakeRecord = {
  id: string;
  userId: string;
  subjectId: string;
  gate: ProactivityWakeGateInput;
  contactTarget: string | null;
  context: ProactivityWakeContextSnapshot;
  status: ProactivityWakeStatus;
  modelTaskId: string | null;
  decision: ProactivityWakeDecision | null;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
};

export type ProactivityWakeRevalidation = {
  gate: ProactivityWakeGateInput;
  activityChanged: boolean;
};

export interface ProactivityWakeGateRevalidator {
  revalidate(input: {
    wake: ProactivityWakeRecord;
    evaluatedAt: string;
  }): Promise<ProactivityWakeRevalidation>;
}

export interface ProactivityWakePort {
  createOrGet(input: {
    gate: ProactivityWakeGateInput;
    contactTarget: string | null;
    context: ProactivityWakeContextSnapshot;
  }): Promise<ProactivityWakeRecord>;

  get(input: {
    userId: string;
    wakeId: string;
  }): Promise<ProactivityWakeRecord | null>;

  markWaitingModel(input: {
    userId: string;
    wakeId: string;
    modelTaskId: string;
  }): Promise<ProactivityWakeRecord>;

  completeDecision(input: {
    userId: string;
    wakeId: string;
    decision: ProactivityWakeDecision;
  }): Promise<ProactivityWakeRecord>;
}

export function normalizeProactivityWakeContext(
  input: ProactivityWakeContextSnapshot,
): ProactivityWakeContextSnapshot {
  if (input.version !== 1) {
    throw new Error(
      "Proactivity wake context version is unsupported.",
    );
  }
  const contextManifestId =
    input.contextManifestId === null
      ? null
      : input.contextManifestId.trim();
  if (
    input.contextManifestId !== null
    && !contextManifestId
  ) {
    throw new Error(
      "Proactivity wake context manifest id must not be blank.",
    );
  }

  const capsule = input.capsule
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .trim();
  if ([...capsule].length > 8_000) {
    throw new Error(
      "Proactivity wake context capsule is too long.",
    );
  }

  const sourceConversationId =
    normalizeOptionalId(
      input.sourceConversationId,
      "sourceConversationId",
    );
  const sourceHeadMessageId =
    normalizeOptionalId(
      input.sourceHeadMessageId,
      "sourceHeadMessageId",
    );
  const sourceActivityAt =
    input.sourceActivityAt === undefined
    || input.sourceActivityAt === null
      ? null
      : new Date(
          requireTimestamp(
            input.sourceActivityAt,
            "sourceActivityAt",
          ),
        ).toISOString();

  return {
    version: 1,
    contextManifestId,
    capsule,
    sourceConversationId,
    sourceHeadMessageId,
    sourceActivityAt,
  };
}


function normalizeOptionalId(
  value: string | null | undefined,
  field: string,
): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(
      "Proactivity wake context " + field + " must not be blank.",
    );
  }
  return normalized;
}

function requireTimestamp(
  value: string,
  field: string,
): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      "Proactivity wake context " + field + " must be an ISO timestamp.",
    );
  }
  return parsed;
}
