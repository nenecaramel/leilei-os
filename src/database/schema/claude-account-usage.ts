import { sql } from "drizzle-orm";
import {
  check,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  users,
} from "./users.js";


export const runtimeClaudeAccountUsageSnapshots = pgTable(
  "runtime_claude_account_usage_snapshots",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    provider: varchar("provider", { length: 32 })
      .$type<"claude_code">()
      .notNull(),
    snapshot: jsonb("snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    providerSessionId: text("provider_session_id"),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.provider],
      name: "runtime_claude_account_usage_snapshots_pk",
    }),
    check(
      "runtime_claude_account_usage_snapshots_provider_allowed",
      sql`${table.provider} IN ('claude_code')`,
    ),
    check(
      "runtime_claude_account_usage_snapshots_snapshot_object",
      sql`jsonb_typeof(${table.snapshot}) = 'object'`,
    ),
    check(
      "runtime_claude_account_usage_snapshots_provider_session_not_blank",
      sql`${table.providerSessionId} IS NULL OR char_length(btrim(${table.providerSessionId})) > 0`,
    ),
  ],
);
