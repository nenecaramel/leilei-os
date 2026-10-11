import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase } from '../src/database/client.js';
import { listNativeSessionSwitchChoices } from '../src/domains/conversation/native-session-history-repository.js';
const enabled = process.env.RUN_NATIVE_SESSION_PICKER_DATABASE_TEST === '1';

test('real Postgres catalog isolates owner and binds only the current canonical head checkpoint', { skip: !enabled }, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname)); assert.notEqual(process.env.NODE_ENV, 'production');
  const database = createDatabase(url.toString(), { ssl: false });
  try {
    await database.db.transaction(async tx => {
      // Temporary tables shadow only this connection; no existing table is written.
      await tx.execute(sql`CREATE TEMP TABLE conversations (id uuid, user_id uuid, title text, updated_at timestamptz, current_head_message_id uuid, provider_metadata jsonb, origin text, lifecycle_status text) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMP TABLE conversation_provider_session_checkpoints (user_id uuid, conversation_id uuid, canonical_message_id uuid, provider text, provider_session_id text, provider_checkpoint_id text) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMP TABLE native_live_turn_preparations (user_id uuid, conversation_id uuid, dispatch_status text) ON COMMIT DROP`);
      const owner = randomUUID(), other = randomUUID(), conversation = randomUUID(), head = randomUUID(), sid = randomUUID(), cp = randomUUID();
      await tx.execute(sql`INSERT INTO conversations VALUES (${conversation}::uuid,${owner}::uuid,'same title',now(),${head}::uuid,${JSON.stringify({nativeSessionSource:{sessionId:sid}})}::jsonb,'native_live','active'),
        (${randomUUID()}::uuid,${other}::uuid,'PRIVATE_OTHER_TITLE',now(),${head}::uuid,'{}','native_live','active'),
        (${randomUUID()}::uuid,${owner}::uuid,'archived',now(),${head}::uuid,'{}','native_live','archived')`);
      await tx.execute(sql`INSERT INTO conversation_provider_session_checkpoints VALUES (${owner}::uuid,${conversation}::uuid,${head}::uuid,'claude_code',${sid},${cp}),
        (${owner}::uuid,${conversation}::uuid,${randomUUID()}::uuid,'claude_code',${randomUUID()},${randomUUID()}),
        (${other}::uuid,${conversation}::uuid,${head}::uuid,'claude_code',${randomUUID()},${randomUUID()})`);
      const before = await listNativeSessionSwitchChoices(tx as any, { userId: owner });
      assert.equal(before.truncated, false); assert.equal(before.conversations.length, 1);
      assert.equal(before.conversations[0]!.conversationId, conversation);
      assert.equal(before.conversations[0]!.providerSessionId, sid);
      assert.equal(before.conversations[0]!.providerCheckpointId, cp);
      assert.equal(before.conversations[0]!.sourceSessionId, sid);
      assert.equal(before.conversations[0]!.busy, false);
      assert.doesNotMatch(JSON.stringify(before), /PRIVATE_OTHER_TITLE/);
      for (const status of ['staged','pending','reserved','executing','delivery_unknown','completed','rejected']) {
        await tx.execute(sql`DELETE FROM native_live_turn_preparations`);
        await tx.execute(sql`INSERT INTO native_live_turn_preparations VALUES (${owner}::uuid,${conversation}::uuid,${status})`);
        const result = await listNativeSessionSwitchChoices(tx as any, { userId: owner });
        assert.equal(result.conversations[0]!.busy, !['completed','rejected'].includes(status));
      }
      await tx.execute(sql`UPDATE conversations SET current_head_message_id = ${randomUUID()}::uuid WHERE id = ${conversation}::uuid`);
      assert.equal((await listNativeSessionSwitchChoices(tx as any, { userId: owner })).conversations[0]!.providerSessionId, null);
    });
  } finally { await database.close(); }
});
