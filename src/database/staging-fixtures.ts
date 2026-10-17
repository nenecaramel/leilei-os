import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { users, runtimeSubjectStates } from "./schema.js";
import { createMindState } from "../domains/runtime/mind/mind-writer.js";

// Only synthetic fixtures in the isolated Railway PR #1142 project.
// Never run against production or copy a real user's Mind data.
let fixtureStage = "guard";
async function main(): Promise<void> {
  const fixtureUser = "3445d472-2bdd-4917-b462-1d3c7c4a5229";
  if (process.env.RAILWAY_PROJECT_ID !== "7e2d02fa-0256-4edd-86af-308e305b1f2c"
    || process.env.RAILWAY_ENVIRONMENT_ID !== "e4d1f0ac-31bf-466c-ad8b-3e85bc0d2b6b"
    || process.env.RAILWAY_SERVICE_ID !== "44a396e4-5e62-4929-848c-2abb1e6eae0c"
    || process.env.RAILWAY_ENVIRONMENT_NAME !== "staging"
    || process.env.MCP_USER_ID !== fixtureUser) {
    throw new Error("Refusing non-fixture staging seed.");
  }
  const url = process.env.DATABASE_URL;
  if (!url || !new URL(url).hostname.endsWith(".railway.internal")) {
    throw new Error("Refusing non-private staging fixture DB.");
  }
  fixtureStage = "connect";
  const client = postgres(url, {max:1, prepare:false, ssl:"require", connect_timeout:3});
  const rows = [
    ["11111111-1111-4111-8111-111111111111", "做面包时面团需要充分发酵。", false],
    ["22222222-2222-4222-8222-222222222222", "过去曾经因为承诺被反复打破而发生争执。", false],
    ["33333333-3333-4333-8333-333333333333", "这是不应出现在召回中的隐藏测试记录。", true],
  ] as const;
  try {
    const db = drizzle(client);
    await db.transaction(async transaction => {
      fixtureStage = "insert_user";
      await transaction.insert(users).values({
        id: fixtureUser,
        email: "mind-staging-fixture@example.invalid",
        displayName: "Synthetic Mind Tester",
        status: "active",
      }).onConflictDoNothing();
      for (const [id, text, hidden] of rows) {
        fixtureStage = hidden ? "insert_hidden" : "insert_memory";
        const state = createMindState({
          id, userId: fixtureUser, subjectId: "G", kind: "memory", text,
          source: {origin: "manual", occurredAt: null, note: null},
        });
        if (hidden) state.envelope.scope.visibility = "hidden_system";
        await transaction.insert(runtimeSubjectStates).values({
          id: state.id,
          userId: fixtureUser,
          subjectId: "G",
          kind: "memory",
          text: state.text ?? text,
          payload: state.payload ?? null,
          scopeApplicability: state.envelope.scope.applicability,
          scopeConversationId: null,
          scopePathHeadMessageId: null,
          settlementStatus: state.envelope.status.settlementStatus,
          pathStatus: state.envelope.status.pathStatus,
          validityStatus: state.envelope.status.validityStatus,
          envelope: {...state.envelope},
        }).onConflictDoNothing();
      }
    });
    console.info("Synthetic Mind staging fixtures ready.");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : "UNKNOWN";
  const constraint = error && typeof error === "object" && "constraint_name" in error && typeof error.constraint_name === "string" && /^runtime_subject_states_[a-z0-9_]{1,96}$/.test(error.constraint_name) ? error.constraint_name : "UNKNOWN";
  console.error(`Synthetic Mind staging fixture failed. stage=${fixtureStage} code=${code} constraint=${constraint}`);
  process.exitCode = 1;
});
