import type {
  SentinelMutationResult,
  SentinelRecord,
} from "./sentinel-types.js";
import type { SentinelRepository } from "./sentinel-repository.js";

export type {
  SentinelMutationResult,
  SentinelRecord,
} from "./sentinel-types.js";

const MIN_NEXT_WAKE_MS = 5 * 60 * 1_000;
const MAX_NEXT_WAKE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_POLICY_CODE_POINTS = 4_000;
const MAX_CAPSULE_CODE_POINTS = 1_024;

export type SentinelDomainErrorCode =
  | "INVALID_USER_ID"
  | "INVALID_TIMEZONE"
  | "INVALID_POLICY_PROMPT"
  | "INVALID_NEXT_WAKE"
  | "NEXT_WAKE_TOO_SOON"
  | "NEXT_WAKE_TOO_FAR"
  | "INVALID_CAPSULE"
  | "CAPSULE_TOO_LONG"
  | "INVALID_CONTROL_REVISION"
  | "SENTINEL_NOT_FOUND";

export class SentinelDomainError extends Error {
  constructor(
    readonly code: SentinelDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SentinelDomainError";
  }
}

export type SentinelStatus =
  | "paused"
  | "recovery_required"
  | "processing"
  | "waiting_for_chatgpt"
  | "sleeping"
  | "waking";

export type SentinelStatusProjectionInput = {
  enabled: boolean;
  recoveryRequired: boolean;
  processing: boolean;
  listenerAvailable: boolean;
  wakePending?: boolean;
  nextWakeAt: Date | null;
  now: Date;
};

export function projectSentinelStatus(
  input: SentinelStatusProjectionInput,
): SentinelStatus {
  if (!input.enabled) return "paused";
  if (input.recoveryRequired) return "recovery_required";
  if (input.processing) return "processing";
  if (
    input.wakePending === true ||
    (!input.listenerAvailable &&
      input.nextWakeAt !== null &&
      input.nextWakeAt <= input.now)
  ) {
    return "waiting_for_chatgpt";
  }
  if (input.nextWakeAt !== null && input.nextWakeAt > input.now) {
    return "sleeping";
  }
  return "waking";
}

export function validateNextWake(now: Date, nextWakeAt: Date): void {
  if (!Number.isFinite(nextWakeAt.getTime())) {
    throw new SentinelDomainError("INVALID_NEXT_WAKE", "Next wake time is invalid.");
  }
  const delay = nextWakeAt.getTime() - now.getTime();
  if (delay < MIN_NEXT_WAKE_MS) {
    throw new SentinelDomainError("NEXT_WAKE_TOO_SOON", "Next wake is too soon.");
  }
  if (delay > MAX_NEXT_WAKE_MS) {
    throw new SentinelDomainError("NEXT_WAKE_TOO_FAR", "Next wake is too far away.");
  }
}

export function normalizeWakeContextCapsule(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new SentinelDomainError("INVALID_CAPSULE", "Wake context capsule is invalid.");
  }
  const normalized = value.normalize("NFC").trim();
  if ([...normalized].length > MAX_CAPSULE_CODE_POINTS) {
    throw new SentinelDomainError("CAPSULE_TOO_LONG", "Wake context capsule is too long.");
  }
  return normalized || null;
}

function normalizeUserId(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) {
    throw new SentinelDomainError("INVALID_USER_ID", "User id is required.");
  }
  return normalized;
}

function validatePolicyInput(input: { timezone: string; policyPrompt: string }): {
  timezone: string;
  policyPrompt: string;
} {
  const timezone = input.timezone.trim();
  if (!timezone || [...timezone].length > 64) {
    throw new SentinelDomainError("INVALID_TIMEZONE", "Timezone is invalid.");
  }
  const policyPrompt = input.policyPrompt.trim();
  if ([...policyPrompt].length > MAX_POLICY_CODE_POINTS) {
    throw new SentinelDomainError("INVALID_POLICY_PROMPT", "Policy prompt is too long.");
  }
  return { timezone, policyPrompt };
}

export class SentinelService {
  constructor(private readonly repository: SentinelRepository) {}

  async findSentinel(userId: string): Promise<SentinelRecord | null> {
    const normalizedUserId = normalizeUserId(userId);
    return this.repository.findByUserId(normalizedUserId);
  }

  async ensureSentinel(
    userId: string,
    input: { timezone: string; policyPrompt: string },
  ): Promise<SentinelRecord> {
    const normalizedUserId = normalizeUserId(userId);
    const existing = await this.repository.findByUserId(normalizedUserId);
    if (existing) return existing;

    const normalized = validatePolicyInput(input);
    try {
      return await this.repository.createSentinel({
        userId: normalizedUserId,
        ...normalized,
      });
    } catch (error: unknown) {
      // A concurrent owner request may have won the one-row-per-user race.
      const raced = await this.repository.findByUserId(normalizedUserId);
      if (raced) return raced;
      throw error;
    }
  }

  async updatePolicy(
    userId: string,
    input: { timezone?: string; policyPrompt?: string },
  ): Promise<SentinelMutationResult> {
    const normalizedUserId = normalizeUserId(userId);
    const current = await this.repository.findByUserId(normalizedUserId);
    if (!current) return { outcome: "not_found" };
    const normalized = validatePolicyInput({
      timezone: input.timezone ?? current.timezone,
      policyPrompt: input.policyPrompt ?? current.policyPrompt,
    });
    return this.repository.updatePolicy({ userId: normalizedUserId, ...normalized });
  }

  async advanceControlRevision(
    userId: string,
    expectedRevision: number,
  ): Promise<SentinelMutationResult> {
    const normalizedUserId = normalizeUserId(userId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new SentinelDomainError("INVALID_CONTROL_REVISION", "Control revision is invalid.");
    }
    return this.repository.compareAndAdvanceRevision({
      userId: normalizedUserId,
      expectedRevision,
    });
  }
}
