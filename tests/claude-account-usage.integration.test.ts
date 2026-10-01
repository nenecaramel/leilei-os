import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  runtimeClaudeAccountUsageSnapshots,
  users,
} from "../src/database/schema.js";
import {
  DrizzleClaudeAccountUsageRepository,
} from "../src/domains/runtime/claude-account-usage.js";

const enabled =
  process.env.RUN_CLAUDE_ACCOUNT_USAGE_DATABASE_TEST === "1";

test(
  "Claude account usage keeps the latest meaningful per-user snapshot",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");
    const database = createDatabase(databaseUrl, { ssl: false });

    const suffix = crypto.randomUUID();
    const created = await database.db
      .insert(users)
      .values([
        {
          email: "claude-usage-a-" + suffix + "@example.com",
          displayName: "Claude Usage A",
        },
        {
          email: "claude-usage-b-" + suffix + "@example.com",
          displayName: "Claude Usage B",
        },
      ])
      .returning({ id: users.id });
    assert.equal(created.length, 2);
    const userA = created[0]!.id;
    const userB = created[1]!.id;

    t.after(async () => {
      try {
        await database.db
          .delete(runtimeClaudeAccountUsageSnapshots)
          .where(eq(runtimeClaudeAccountUsageSnapshots.userId, userA));
        await database.db
          .delete(users)
          .where(eq(users.id, userA));
        await database.db
          .delete(users)
          .where(eq(users.id, userB));
      } finally {
        await database.close();
      }
    });

    const observed = [
      new Date("2026-10-01T10:15:00.000Z"),
      new Date("2026-10-01T10:16:00.000Z"),
    ];
    let nowIndex = 0;
    const repository = new DrizzleClaudeAccountUsageRepository(
      database.db,
      () => observed[Math.min(nowIndex++, observed.length - 1)]!,
    );

    await repository.observeRuntimeEvents({
      userId: userA,
      events: [{
        sequence: 1,
        event: {
          type: "runtime",
          provider_session_id: "provider-a",
          payload: {
            kind: "claude_account_usage",
            provider: "claude_code",
            status: "allowed",
            active_window: "five_hour",
            windows: [{
              kind: "five_hour",
              utilization: 0.42,
              resets_at: "2026-10-01T12:00:00.000Z",
            }],
            overage: null,
            surpassed_threshold: null,
          },
        },
      }],
    });

    assert.deepEqual(await repository.readLatest(userA), {
      provider: "claude_code",
      windows: [{
        kind: "five_hour",
        utilization: 0.42,
        resets_at: "2026-10-01T12:00:00.000Z",
      }],
      overage: null,
      observed_at: "2026-10-01T10:15:00.000Z",
    });
    assert.equal(await repository.readLatest(userB), null);

    await repository.observeRuntimeEvents({
      userId: userA,
      events: [{
        sequence: 2,
        event: {
          type: "runtime",
          provider_session_id: "provider-a",
          payload: {
            kind: "claude_account_usage",
            provider: "claude_code",
            status: null,
            active_window: null,
            windows: [],
            overage: null,
            surpassed_threshold: null,
          },
        },
      }],
    });

    assert.equal(
      (await repository.readLatest(userA))?.observed_at,
      "2026-10-01T10:15:00.000Z",
      "an empty SDK rate-limit payload must not erase a useful snapshot",
    );

    await repository.observeRuntimeEvents({
      userId: userA,
      events: [{
        sequence: 3,
        event: {
          type: "runtime",
          provider_session_id: "provider-b",
          payload: {
            kind: "claude_account_usage",
            provider: "claude_code",
            status: "allowed_warning",
            active_window: "seven_day",
            windows: [{
              kind: "seven_day",
              utilization: 0.81,
              resets_at: "2026-10-05T06:00:00.000Z",
            }],
            overage: {
              status: "allowed",
              resets_at: null,
              disabled_reason: null,
              is_using: false,
            },
            surpassed_threshold: 0.75,
          },
        },
      }],
    });

    assert.deepEqual(await repository.readLatest(userA), {
      provider: "claude_code",
      windows: [{
        kind: "seven_day",
        utilization: 0.81,
        resets_at: "2026-10-05T06:00:00.000Z",
      }],
      overage: {
        status: "allowed",
        resets_at: null,
        disabled_reason: null,
        is_using: false,
      },
      observed_at: "2026-10-01T10:16:00.000Z",
    });
  },
);
