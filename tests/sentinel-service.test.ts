import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeWakeContextCapsule,
  projectSentinelStatus,
  SentinelDomainError,
  SentinelService,
  validateNextWake,
  type SentinelRepository,
  type SentinelRecord,
} from "../src/domains/sentinel/sentinel-service.js";

function makeRecord(overrides: Partial<SentinelRecord> = {}): SentinelRecord {
  const now = new Date("2026-08-29T00:00:00.000Z");
  return {
    id: "sentinel-1",
    userId: "user-1",
    enabled: false,
    timezone: "Asia/Shanghai",
    policyPrompt: "",
    nextWakeAt: null,
    lastValidWakeAt: null,
    wakeContextCapsule: null,
    wakeContextUpdatedAt: null,
    controlRevision: 0,
    activeWakeRunId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

class FakeSentinelRepository implements SentinelRepository {
  private record: SentinelRecord | null = null;

  async findByUserId(userId: string): Promise<SentinelRecord | null> {
    return this.record?.userId === userId ? this.record : null;
  }

  async createSentinel(input: {
    userId: string;
    timezone: string;
    policyPrompt: string;
  }): Promise<SentinelRecord> {
    this.record = makeRecord({
      userId: input.userId,
      timezone: input.timezone,
      policyPrompt: input.policyPrompt,
    });
    return this.record;
  }

  async updatePolicy(input: {
    userId: string;
    timezone: string;
    policyPrompt: string;
  }): Promise<{ outcome: "applied" | "not_found"; sentinel?: SentinelRecord }> {
    if (!this.record || this.record.userId !== input.userId) {
      return { outcome: "not_found" };
    }
    this.record = {
      ...this.record,
      timezone: input.timezone,
      policyPrompt: input.policyPrompt,
    };
    return { outcome: "applied", sentinel: this.record };
  }

  async compareAndAdvanceRevision(input: {
    userId: string;
    expectedRevision: number;
  }): Promise<
    | { outcome: "applied"; sentinel: SentinelRecord }
    | { outcome: "conflict" | "not_found" }
  > {
    if (!this.record || this.record.userId !== input.userId) {
      return { outcome: "not_found" };
    }
    if (this.record.controlRevision !== input.expectedRevision) {
      return { outcome: "conflict" };
    }
    this.record = {
      ...this.record,
      controlRevision: this.record.controlRevision + 1,
    };
    return { outcome: "applied", sentinel: this.record };
  }
}

test("new Sentinel is disabled and has no scheduled wake", async () => {
  const repository = new FakeSentinelRepository();
  const service = new SentinelService(repository);

  const created = await service.ensureSentinel("user-1", {
    timezone: "Asia/Shanghai",
    policyPrompt: "Keep autonomous contact gentle.",
  });

  assert.equal(created.enabled, false);
  assert.equal(created.nextWakeAt, null);
});

test("policy/timezone updates do not implicitly enable the Sentinel", async () => {
  const repository = new FakeSentinelRepository();
  const service = new SentinelService(repository);
  await service.ensureSentinel("user-1", {
    timezone: "UTC",
    policyPrompt: "",
  });

  const result = await service.updatePolicy("user-1", {
    timezone: "Asia/Shanghai",
    policyPrompt: "Updated policy",
  });

  assert.equal(result.outcome, "applied");
  assert.equal(result.sentinel?.enabled, false);
  assert.equal(result.sentinel?.timezone, "Asia/Shanghai");
  assert.equal(result.sentinel?.policyPrompt, "Updated policy");
  assert.equal(result.sentinel?.controlRevision, 0);
});

test("next wake validation enforces five-minute and seven-day bounds", () => {
  const now = new Date("2026-08-29T00:00:00.000Z");
  assert.throws(
    () => validateNextWake(now, new Date(now.getTime() + 4 * 60 * 1000)),
    (error: unknown) =>
      error instanceof SentinelDomainError && error.code === "NEXT_WAKE_TOO_SOON",
  );
  assert.throws(
    () => validateNextWake(now, new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000)),
    (error: unknown) =>
      error instanceof SentinelDomainError && error.code === "NEXT_WAKE_TOO_FAR",
  );
  assert.doesNotThrow(() =>
    validateNextWake(now, new Date(now.getTime() + 5 * 60 * 1000)),
  );
});

test("wake context capsule is normalized by Unicode code point and bounded", () => {
  const capsule = normalizeWakeContextCapsule("e\u0301".repeat(512));
  assert.equal(capsule, "é".repeat(512));
  assert.equal(
    normalizeWakeContextCapsule("😀".repeat(1_024)),
    "😀".repeat(1_024),
  );
  assert.throws(
    () => normalizeWakeContextCapsule("😀".repeat(1_025)),
    (error: unknown) =>
      error instanceof SentinelDomainError && error.code === "CAPSULE_TOO_LONG",
  );
});

test("control revision advances monotonically and rejects stale owners", async () => {
  const repository = new FakeSentinelRepository();
  const service = new SentinelService(repository);
  await service.ensureSentinel("user-1", {
    timezone: "UTC",
    policyPrompt: "",
  });

  const applied = await service.advanceControlRevision("user-1", 0);
  assert.equal(applied.outcome, "applied");
  assert.equal(applied.sentinel?.controlRevision, 1);

  const conflict = await service.advanceControlRevision("user-1", 0);
  assert.deepEqual(conflict, { outcome: "conflict" });
});

test("owner-safe reads do not reveal another owner's Sentinel", async () => {
  const repository = new FakeSentinelRepository();
  const service = new SentinelService(repository);
  await service.ensureSentinel("user-1", {
    timezone: "UTC",
    policyPrompt: "private policy",
  });

  assert.equal(await service.findSentinel("user-2"), null);
});

test("status projection follows paused, recovery, processing, waiting, sleeping, waking priority", () => {
  const now = new Date("2026-08-29T00:00:00.000Z");
  const base = {
    enabled: true,
    recoveryRequired: false,
    processing: false,
    listenerAvailable: true,
    nextWakeAt: new Date(now.getTime() + 60 * 60 * 1000),
    now,
  };

  assert.equal(projectSentinelStatus({ ...base, enabled: false }), "paused");
  assert.equal(projectSentinelStatus({ ...base, recoveryRequired: true }), "recovery_required");
  assert.equal(projectSentinelStatus({ ...base, processing: true }), "processing");
  assert.equal(projectSentinelStatus({ ...base, listenerAvailable: false, nextWakeAt: now }), "waiting_for_chatgpt");
  assert.equal(projectSentinelStatus(base), "sleeping");
  assert.equal(projectSentinelStatus({ ...base, nextWakeAt: now }), "waking");
});
