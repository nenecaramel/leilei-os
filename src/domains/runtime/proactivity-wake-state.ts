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

  return {
    version: 1,
    contextManifestId,
    capsule,
  };
}
