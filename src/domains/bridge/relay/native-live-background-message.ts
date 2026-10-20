import { sql } from "drizzle-orm";
import { DrizzleNativeLiveAttachmentBinding } from "../attachment/native-live-attachment-service.js";
import type { createDatabase } from "../../../database/client.js";
import { conversationMessages } from "../../../database/schema.js";
import { canonicalizeNativeLiveEvents } from "../../conversation/native-live-conversation-orchestrator.js";
import { DrizzleNativeLiveConversationRepository } from "../../conversation/native-live-conversation-repository.js";
import { NativeLiveBackgroundResultError, type NativeLiveBackgroundIdentity } from "../protocol/native-live-background-result.js";
import type { NativeLiveRuntimeExecutionResult } from "../protocol/native-live-runtime-protocol.js";
import type { NativeLiveBackgroundReceipt } from "./native-live-background-result-repository.js";
import { readNativeWriterGeneration, advanceNativeSessionTurnAnchor } from "../turn/turn-repository/session-owner.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (tx: infer T) => unknown ? T : never;

// A receipt's permanent identity belongs to its real message/checkpoint. It
// must remain readable after operational preparations and events expire.
export async function readDurableBackgroundReceipt(tx: Transaction, userId: string, identity: NativeLiveBackgroundIdentity) {
  const [row] = await tx.execute<{ receipt: NativeLiveBackgroundReceipt | null }>(sql`
    SELECT runtime_metadata->'native_live_background_receipt' AS receipt
    FROM conversation_provider_session_checkpoints
    WHERE user_id=${userId}::uuid AND canonical_message_id=${identity.receiptId}::uuid
      AND provider='claude_code' LIMIT 1
  `);
  return row?.receipt ?? null;
}

export async function appendBackgroundMessage(tx: Transaction, input: {
  userId: string; conversationId: string; receipt: NativeLiveBackgroundReceipt;
  result: Extract<NativeLiveRuntimeExecutionResult, { status: "success" }>;
}): Promise<boolean> {
  const { receipt, result } = input;
  const canonical = canonicalizeNativeLiveEvents(result.normalized_events);
  if (canonical.error) throw new NativeLiveBackgroundResultError("INVALID_BACKGROUND_RESULT");
  // Quiet native activity moves its continuation cursor without an empty bubble.
  if (canonical.blocks.length === 0 && !result.output_attachment_ids?.length) return false;
  const now = new Date();
  await tx.insert(conversationMessages).values({
    id: receipt.identity.receiptId, userId: input.userId, conversationId: input.conversationId,
    parentMessageId: receipt.context.canonicalMessageId, role: "assistant", status: "completed", completedAt: now,
  });
  const repository = new DrizzleNativeLiveConversationRepository(tx);
  for (const [ordinal, block] of canonical.blocks.entries()) {
    await repository.appendContentBlock({ ...input, messageId: receipt.identity.receiptId, ordinal, block });
  }
  if (result.output_attachment_ids?.length) {
    await new DrizzleNativeLiveAttachmentBinding(tx, 8).bindReadyToMessage({
      userId: input.userId, messageId: receipt.identity.receiptId,
      attachmentIds: result.output_attachment_ids,
      attachmentMetadata: result.output_attachment_metadata,
      startOrdinal: canonical.blocks.length, contentOrigin: "provider_send",
    });
  }
  const writerGeneration = await readNativeWriterGeneration(tx, { userId: input.userId, conversationId: input.conversationId });
  await repository.bindProviderCheckpoint({
    userId: input.userId, conversationId: input.conversationId, canonicalMessageId: receipt.identity.receiptId,
    checkpoint: {
      provider: "claude_code", providerSessionId: result.provider_session_id,
      providerCheckpointId: receipt.coveringCheckpointId ?? result.provider_checkpoint_id!, effectiveWorkingDirectory: result.effective_working_directory,
      runtimeMetadata: {
        provider_checkpoint_version: 1,
        native_live_generation: { presentation_owner_id: receipt.context.presentationOwnerId, source_revision: receipt.context.sourceRevision, writer_generation: writerGeneration },
        native_live_background_receipt: receipt,
        ...(receipt.coveringCheckpointId ? {
          // Producer B is an earlier SDK record; F's verified descendant is
          // the latest safe continuation. Never roll the canonical head to B.
          native_live_background_producer_checkpoint_id: result.provider_checkpoint_id,
        } : {}),
      },
    },
  });
  await repository.setCurrentHead({ userId: input.userId, conversationId: input.conversationId, messageId: receipt.identity.receiptId });
  const anchored = await tx.execute<{ slot: string | null }>(sql`SELECT o.turn_prepare_id::text AS slot
    FROM conversations c JOIN native_live_session_owners o ON o.conversation_id=c.id AND o.user_id=c.user_id
    JOIN conversation_provider_session_checkpoints cp ON cp.conversation_id=o.conversation_id AND cp.user_id=o.user_id
      AND cp.canonical_message_id=${receipt.context.canonicalMessageId}::uuid AND cp.provider='claude_code'
    WHERE c.id=${input.conversationId}::uuid AND c.user_id=${input.userId}::uuid
      AND o.conversation_id=c.id AND o.user_id=c.user_id
      AND c.current_head_message_id=${receipt.identity.receiptId}::uuid
      AND coalesce(cp.runtime_metadata->'native_live_generation'->>'writer_generation',
        cp.runtime_metadata->'native_live_generation'->>'presentation_owner_id')=o.writer_generation::text
      AND (o.turn_prepare_id::text=${receipt.context.presentationOwnerId}::text
        OR NOT EXISTS (SELECT 1 FROM native_live_turn_preparations active
          WHERE active.user_id=c.user_id AND active.conversation_id=c.id
            AND active.id::text=o.turn_prepare_id::text
            AND active.status='prepared' AND active.dispatch_status IN ('staged','pending','reserved','executing','delivery_unknown')))
      AND o.turn_anchor_message_id::text IS NOT DISTINCT FROM ${receipt.context.canonicalMessageId}::text
    `);
  // This update and the message/checkpoint/head append share one SERIALIZABLE
  // transaction. Never commit an unowned head whose presentation owner still
  // points to the previous assistant: the next input would use a stale anchor.
  if (anchored.length !== 1) throw new NativeLiveBackgroundResultError("BACKGROUND_CONFLICT");
  const advanced = await advanceNativeSessionTurnAnchor(tx, {
    userId: input.userId, conversationId: input.conversationId,
    expectedPrepareId: anchored[0]!.slot, expectedAnchor: receipt.context.canonicalMessageId,
    newAnchor: receipt.identity.receiptId,
  });
  if (advanced !== 1) throw new NativeLiveBackgroundResultError("BACKGROUND_CONFLICT");
  return true;
}
