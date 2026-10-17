import postgres from "postgres";
import { createMindState } from "../domains/runtime/mind/mind-writer.js";

// Only synthetic fixtures in the isolated Railway PR #1142 project.
// Never run against production or copy a real user's Mind data.
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
  const client = postgres(url, {max:1, prepare:false, ssl:"require", connect_timeout:3});
  const rows = [
    ["11111111-1111-4111-8111-111111111111", "做面包时面团需要充分发酵。", false],
    ["22222222-2222-4222-8222-222222222222", "过去曾经因为承诺被反复打破而发生争执。", false],
    ["33333333-3333-4333-8333-333333333333", "这是不应出现在召回中的隐藏测试记录。", true],
  ] as const;
  try {
    await client.begin(async transaction => {
      await transaction`
        insert into public.users (id, email, display_name, status)
        values (${fixtureUser}::uuid, 'mind-staging-fixture@example.invalid', 'Synthetic Mind Tester', 'active')
        on conflict (id) do nothing
      `;
      for (const [id, text, hidden] of rows) {
        const state = createMindState({
          id, userId: fixtureUser, subjectId:"G", kind:"memory", text,
          source: {origin:"manual", occurredAt:null, note:null},
        });
        if (hidden) state.envelope.scope.visibility = "hidden_system";
        await transaction`
          insert into public.runtime_subject_states
            (id, user_id, subject_id, kind, text, payload,
             scope_applicability, scope_conversation_id, scope_path_head_message_id,
             settlement_status, path_status, validity_status, envelope)
          values (
            ${state.id}::uuid, ${fixtureUser}::uuid, 'G', 'memory',
            ${state.text}, ${JSON.stringify(state.payload ?? null)}::jsonb,
            ${state.envelope.scope.applicability}, null, null,
            ${state.envelope.status.settlementStatus},
            ${state.envelope.status.pathStatus},
            ${state.envelope.status.validityStatus},
            ${JSON.stringify(state.envelope)}::jsonb
          )
          on conflict (id) do nothing
        `;
      }
    });
    console.info("Synthetic Mind staging fixtures ready.");
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("Synthetic Mind staging fixture setup failed.");
  process.exitCode = 1;
});
