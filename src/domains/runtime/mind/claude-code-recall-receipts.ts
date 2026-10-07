import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import { claudeCodeRecallReceipts } from "../../../database/schema.js";
import { requireActiveUserInTransaction } from "../../require-active-user-transaction.js";
import { applyFinalizedMemoryRecall } from "../subject-state/subject-state-runtime-repository.js";
import type { MemoryLifecyclePolicy } from "../lifecycle/memory-lifecycle.js";
import { DEFAULT_BREATH_RECALL_SALIENCE_BOOST } from "./default-backend-mind-runtime.js";

export type RecallReceiptInput = {
  userId: string; subjectId: string; conversationId: string; contextEpoch: number;
  stateIds: string[]; contextSha256: string; recalledAt: string;
};
export type RecallConfirmation = {outcome: "confirmed" | "replayed"};
export interface ClaudeCodeRecallReceiptPort {
  create(input: RecallReceiptInput): Promise<{recall_id: string; context_sha256: string}>;
  confirm(input: {userId: string; recallId: string; contextSha256: string}): Promise<RecallConfirmation>;
}

export class DrizzleClaudeCodeRecallReceipts implements ClaudeCodeRecallReceiptPort {
  constructor(private readonly db: ReturnType<typeof createDatabase>["db"], private readonly lifecyclePolicy?: MemoryLifecyclePolicy) {}
  async create(input: RecallReceiptInput) {
    const id = randomUUID();
    await this.db.transaction(async transaction => {
      await requireActiveUserInTransaction(transaction, input.userId);
      await transaction.insert(claudeCodeRecallReceipts).values({
        id, userId: input.userId, subjectId: input.subjectId, conversationId: input.conversationId,
        contextEpoch: input.contextEpoch, stateIds: input.stateIds, contextSha256: input.contextSha256,
        recalledAt: new Date(input.recalledAt), expiresAt: new Date(Date.parse(input.recalledAt) + 86400000),
      });
      // Bounded lazy expiry cleanup; never waits on an in-flight confirmation.
      await transaction.execute(sql`DELETE FROM claude_code_recall_receipts WHERE id IN (
        SELECT id FROM claude_code_recall_receipts WHERE user_id = ${input.userId}::uuid
        AND expires_at < clock_timestamp() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
      )`);
    });
    return {recall_id: id, context_sha256: input.contextSha256};
  }
  async confirm(input: {userId: string; recallId: string; contextSha256: string}): Promise<RecallConfirmation> {
    return this.db.transaction(async transaction => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const [receipt] = await transaction.select().from(claudeCodeRecallReceipts)
        .where(and(eq(claudeCodeRecallReceipts.id, input.recallId), eq(claudeCodeRecallReceipts.userId, input.userId)))
        .for("update").limit(1);
      if (!receipt || receipt.contextSha256 !== input.contextSha256) throw new Error("RECALL_RECEIPT_UNAVAILABLE");
      if (receipt.confirmedAt) return {outcome: "replayed"};
      const [clock] = await transaction.execute<{now: Date}>(sql`SELECT clock_timestamp() AS now`);
      const now = new Date(clock!.now);
      if (receipt.expiresAt <= now) throw new Error("RECALL_RECEIPT_UNAVAILABLE");
      await applyFinalizedMemoryRecall(transaction, {
        userId: receipt.userId, subjectId: receipt.subjectId, stateIds: receipt.stateIds,
        recalledAt: receipt.recalledAt.toISOString(), sourceId: receipt.id,
        conversationId: receipt.conversationId, contextEpoch: receipt.contextEpoch,
        salienceBoost: DEFAULT_BREATH_RECALL_SALIENCE_BOOST, lifecyclePolicy: this.lifecyclePolicy, globalOnly: true,
      });
      await transaction.update(claudeCodeRecallReceipts).set({confirmedAt: now}).where(eq(claudeCodeRecallReceipts.id, receipt.id));
      return {outcome: "confirmed"};
    });
  }
}
