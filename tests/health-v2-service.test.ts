import assert from "node:assert/strict";
import test from "node:test";
import {
  HealthService,
  HealthServiceError,
  normalizeHealthSyncPayload,
} from "../src/domains/health-v2/health-service.js";
import { ActiveUserAuthorizationError } from "../src/domains/require-active-user.js";
import type {
  HealthDailySummary,
  HealthRepository,
  HealthSyncResult,
  NormalizedHealthSync,
} from "../src/domains/health-v2/health-types.js";

const NOW = new Date("2026-09-06T04:00:00.000Z");

function assertInvalidPayload(payload: unknown): void {
  assert.throws(
    () => normalizeHealthSyncPayload(payload as never, NOW),
    (error: unknown) =>
      error instanceof HealthServiceError &&
      error.code === "INVALID_HEALTH_INPUT",
  );
}

test("normalizes duplicate unsorted dates into the latest period run", () => {
  assert.deepEqual(
    normalizeHealthSyncPayload(
      {
        date: "2026-09-06",
        steps: 6842,
        menstruation_dates: ["2026-09-05", "2026-09-04", "2026-09-05"],
      },
      NOW,
    ),
    {
      date: "2026-09-06",
      steps: 6842,
      menstruating: false,
      periodStartDate: "2026-09-04",
      cycleDay: 3,
    },
  );
});

test("normalizes empty menstruation history without cycle fields", () => {
  assert.deepEqual(
    normalizeHealthSyncPayload(
      { date: "2026-09-06", steps: 0, menstruation_dates: [] },
      NOW,
    ),
    {
      date: "2026-09-06",
      steps: 0,
      menstruating: false,
      periodStartDate: null,
      cycleDay: null,
    },
  );
});

test("marks the request date as menstruating when it is recorded", () => {
  assert.deepEqual(
    normalizeHealthSyncPayload(
      {
        date: "2026-09-06",
        steps: 12,
        menstruation_dates: ["2026-09-04", "2026-09-06", "2026-09-05"],
      },
      NOW,
    ),
    {
      date: "2026-09-06",
      steps: 12,
      menstruating: true,
      periodStartDate: "2026-09-04",
      cycleDay: 3,
    },
  );
});

test("chooses the latest consecutive run when history has multiple periods", () => {
  assert.deepEqual(
    normalizeHealthSyncPayload(
      {
        date: "2026-09-06",
        steps: 91,
        menstruation_dates: [
          "2026-08-02",
          "2026-09-02",
          "2026-08-01",
          "2026-09-04",
          "2026-09-03",
        ],
      },
      NOW,
    ),
    {
      date: "2026-09-06",
      steps: 91,
      menstruating: false,
      periodStartDate: "2026-09-02",
      cycleDay: 5,
    },
  );
});

test("accepts menstruation dates from requestDate minus 60 days through requestDate inclusive", () => {
  const now = new Date("2026-10-01T04:00:00.000Z");

  const earliest = normalizeHealthSyncPayload(
    {
      date: "2026-10-01",
      steps: 319,
      menstruation_dates: ["2026-08-02"],
    },
    now,
  );
  assert.equal(earliest.periodStartDate, "2026-08-02");

  const today = normalizeHealthSyncPayload(
    {
      date: "2026-10-01",
      steps: 319,
      menstruation_dates: ["2026-10-01"],
    },
    now,
  );
  assert.equal(today.menstruating, true);

  assert.throws(
    () => normalizeHealthSyncPayload(
      {
        date: "2026-10-01",
        steps: 319,
        menstruation_dates: ["2026-08-01"],
      },
      now,
    ),
    (error: unknown) =>
      error instanceof HealthServiceError
      && error.code === "INVALID_HEALTH_INPUT",
  );

  assert.throws(
    () => normalizeHealthSyncPayload(
      {
        date: "2026-10-01",
        steps: 319,
        menstruation_dates: ["2026-10-02"],
      },
      now,
    ),
    (error: unknown) =>
      error instanceof HealthServiceError
      && error.code === "INVALID_HEALTH_INPUT",
  );
});

test("rejects invalid dates, steps, and menstruation windows", () => {
  const valid = {
    date: "2026-09-06",
    steps: 10,
    menstruation_dates: [] as string[],
  };

  assertInvalidPayload({ ...valid, date: "2026-09-07" });
  assertInvalidPayload({ ...valid, date: "2026-02-30" });
  assertInvalidPayload({ ...valid, date: "09/06/2026" });
  assertInvalidPayload({ ...valid, steps: -1 });
  assertInvalidPayload({ ...valid, steps: 1.5 });
  assertInvalidPayload({ ...valid, steps: 2_147_483_648 });
  assertInvalidPayload({
    ...valid,
    menstruation_dates: Array.from({ length: 61 }, () => "2026-09-06"),
  });
  assertInvalidPayload({ ...valid, menstruation_dates: ["2026-09-07"] });
  assertInvalidPayload({ ...valid, menstruation_dates: ["2026-07-07"] });
  assertInvalidPayload({ ...valid, menstruation_dates: ["2026-02-30"] });
});

class FakeHealthRepository implements HealthRepository {
  calls: string[] = [];

  constructor(
    private readonly user: { status: "active" | "disabled" } | null,
  ) {}

  async findUserById(): Promise<{ status: "active" | "disabled" } | null> {
    this.calls.push("findUserById");
    return this.user;
  }

  async upsertDaily(
    _userId: string,
    summary: NormalizedHealthSync,
  ): Promise<HealthSyncResult> {
    this.calls.push("upsertDaily");
    if (!this.user) {
      throw new ActiveUserAuthorizationError("USER_NOT_FOUND");
    }
    if (this.user.status !== "active") {
      throw new ActiveUserAuthorizationError("USER_DISABLED");
    }
    return {
      created: true,
      summary: { ...summary, updatedAt: NOW },
    };
  }

  async readDay(): Promise<HealthDailySummary | null> {
    this.calls.push("readDay");
    return null;
  }

  async readRange(): Promise<HealthDailySummary[]> {
    this.calls.push("readRange");
    return [];
  }
}

for (const user of [null, { status: "disabled" as const }]) {
  const expectedCode = user === null ? "USER_NOT_FOUND" : "USER_DISABLED";

  test(`readDay rejects ${expectedCode} before reading Health data`, async () => {
    const repository = new FakeHealthRepository(user);
    const service = new HealthService(repository, () => NOW);

    await assert.rejects(
      service.readDay("user-1", "2026-09-06"),
      (error: unknown) =>
        error instanceof HealthServiceError && error.code === expectedCode,
    );
    assert.deepEqual(repository.calls, ["findUserById"]);
  });

  test(`readRecent rejects ${expectedCode} before reading Health data`, async () => {
    const repository = new FakeHealthRepository(user);
    const service = new HealthService(repository, () => NOW);

    await assert.rejects(
      service.readRecent("user-1", 7),
      (error: unknown) =>
        error instanceof HealthServiceError && error.code === expectedCode,
    );
    assert.deepEqual(repository.calls, ["findUserById"]);
  });
}

test("syncDaily normalizes before delegating the owner-scoped upsert", async () => {
  const repository = new FakeHealthRepository({ status: "active" });
  const service = new HealthService(repository, () => NOW);

  const result = await service.syncDaily("user-1", {
    date: "2026-09-06",
    steps: 25,
    menstruation_dates: ["2026-09-05", "2026-09-04"],
  });

  assert.equal(result.summary.periodStartDate, "2026-09-04");
  assert.deepEqual(repository.calls, ["upsertDaily"]);
});

for (const user of [null, { status: "disabled" as const }]) {
  const expectedCode = user === null ? "USER_NOT_FOUND" : "USER_DISABLED";

  test(`syncDaily rejects ${expectedCode} before writing Health data`, async () => {
    const repository = new FakeHealthRepository(user);
    const service = new HealthService(repository, () => NOW);

    await assert.rejects(
      service.syncDaily("user-1", {
        date: "2026-09-06",
        steps: 25,
        menstruation_dates: [],
      }),
      (error: unknown) =>
        error instanceof HealthServiceError && error.code === expectedCode,
    );
    assert.deepEqual(repository.calls, ["upsertDaily"]);
  });
}
