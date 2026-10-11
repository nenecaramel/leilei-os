import { createHash, randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversations, conversationMessages, conversationContentBlocks,
  conversationProviderSessionCheckpoints, nativeLiveTurnPreparations,
  nativeLiveManualCompactions,
} from "../../database/schema.js";
import { DrizzleNativeLiveProviderSessionStoreRepository } from "../bridge/provider-session/native-live-provider-session-store.js";
import { providerSessionOwnershipLock } from "../bridge/provider-session/native-live-provider-session-references.js";
import { inFlightConversationTurns } from "./native-live-conversation-repository.js";
import { storedContentKind, storedContentPayload } from "./native-live-content-contract.js";
import type { NativeLiveContentBlockInput } from "./native-live-conversation-types.js";

type Database = ReturnType<typeof createDatabase>["db"];
export type NativeHistoryMessage = {
  sourceMessageId: string;
  parentSourceMessageId: string | null;
  role: "user" | "assistant";
  createdAt: string | null;
  parentProviderCheckpointId: string | null;
  providerCheckpointId: string;
  sourceEntryUuids: string[];
  blocks: NativeLiveContentBlockInput[];
  fingerprint: string;
};
export type NativeHistoryProjection = {
  schemaVersion: 1;
  sessionId: string;
  revision: string;
  checkpointId: string;
  messages: NativeHistoryMessage[];
};
type SourceIndex = {
  schemaVersion: 1;
  sessionId: string;
  revision: string;
  checkpointId: string;
  effectiveWorkingDirectory: string;
  headMessageId: string;
  messages: Array<{ sourceMessageId: string; fingerprint: string }>;
  owner?: "leileios" | "desktop";
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
const fail = (code: string) => Object.assign(new Error(code), { code });

// Display ends at the assistant; execution may include its native Stop hook receipt.
// Preserve the execution checkpoint. Only this explicitly proven trailing carrier
// is equivalent: never accept a generic ancestor, compact, tool or another turn.
function sameCompletedTurnCheckpoint(
  executionId: string | null, displayId: string, sessionId: string,
  entries?: Array<Record<string, unknown> & { type: string }>,
): boolean {
  if (executionId === displayId) return true;
  if (!executionId || !entries) return false;
  const byId = new Map<string, Record<string, unknown> & { type: string }>();
  for (const entry of entries) {
    if (typeof entry.uuid !== "string") continue;
    if (byId.has(entry.uuid)) return false;
    byId.set(entry.uuid, entry);
  }
  const assistant = byId.get(displayId);
  const message = assistant?.message as Record<string, unknown> | undefined;
  if (!assistant || assistant.type !== "assistant" || assistant.isSidechain === true
    || assistant.isMeta === true || assistant.isCompactSummary === true
    || (assistant.sessionId !== undefined && assistant.sessionId !== sessionId)
    || message?.stop_reason !== "end_turn") return false;
  const visited = new Set<string>();
  let cursor = executionId;
  while (cursor !== displayId) {
    const entry = byId.get(cursor);
    if (!entry || visited.has(cursor) || entry.type !== "system"
      || entry.subtype !== "stop_hook_summary" || entry.isSidechain === true
      || (entry.sessionId !== undefined && entry.sessionId !== sessionId)
      || typeof entry.parentUuid !== "string") return false;
    visited.add(cursor);
    cursor = entry.parentUuid;
  }
  return true;
}

export function validateNativeHistoryRestoreInput(input: Parameters<typeof restoreNativeSessionHistory>[1]) {
  const p = input.projection;
  if (!uuid.test(input.userId) || !uuid.test(input.conversationId) ||
    (input.expectedHeadMessageId !== null && !uuid.test(input.expectedHeadMessageId)) ||
    (input.expectedRevision !== null && !hash.test(input.expectedRevision)) ||
    !isAbsolute(input.effectiveWorkingDirectory) || p.schemaVersion !== 1 ||
    !uuid.test(p.sessionId) || !uuid.test(p.checkpointId) || !hash.test(p.revision) ||
    !p.messages.length || p.messages.length > 10_000 || p.messages.at(-1)?.role !== "assistant" ||
    p.messages.at(-1)?.providerCheckpointId !== p.checkpointId) throw fail("INVALID_NATIVE_PROJECTION");
  const snapshot = input.nativeSnapshot;
  if (snapshot && (snapshot.sessionId !== p.sessionId || snapshot.revision !== p.revision ||
    !Array.isArray(snapshot.entries) || !snapshot.entries.some(entry => entry?.uuid === p.checkpointId))) throw fail("INVALID_NATIVE_SNAPSHOT");

  const seen = new Set<string>();
  for (const [index, message] of p.messages.entries()) {
    const { fingerprint, ...body } = message;
    if (!uuid.test(message.sourceMessageId) || seen.has(message.sourceMessageId) ||
      !["user", "assistant"].includes(message.role) ||
      message.parentSourceMessageId !== (p.messages[index - 1]?.sourceMessageId ?? null) ||
      !uuid.test(message.providerCheckpointId) ||
      (message.parentProviderCheckpointId !== null && !uuid.test(message.parentProviderCheckpointId)) ||
      !message.sourceEntryUuids.length || message.sourceEntryUuids.some(id => !uuid.test(id)) ||
      (message.createdAt !== null && !Number.isFinite(Date.parse(message.createdAt))) ||
      createHash("sha256").update(JSON.stringify(body)).digest("hex") !== fingerprint) throw fail("INVALID_NATIVE_PROJECTION");
    seen.add(message.sourceMessageId);
  }
}

/** Internal only: caller must supply a verified, complete native selected-head snapshot.
 * This writes a display/control projection, never the native source or an execution lease.
 * Completed old messages are immutable; branch changes require a separate explicit restore.
 */
export async function restoreNativeSessionHistory(db: Database, input: {
  userId: string;
  conversationId: string;
  expectedHeadMessageId: string | null;
  expectedRevision: string | null;
  effectiveWorkingDirectory: string;
  projection: NativeHistoryProjection;
  nativeSnapshot?: { sessionId: string; revision: string; entries: Array<Record<string, unknown> & { type: string }> };
}): Promise<{ outcome: "restored" | "already_current"; conversationId: string; headMessageId: string; inserted: number }> {
  validateNativeHistoryRestoreInput(input);
  const p = input.projection;
  const snapshot = input.nativeSnapshot;
  return db.transaction(async tx => {
    // Serialize the initial insert too, when no conversation row exists yet.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('leileios-native-history:' || ${input.conversationId}, 0))`);
    const [existing] = await tx.select().from(conversations).where(eq(conversations.id, input.conversationId)).for("update");
    if (existing && (existing.userId !== input.userId || existing.origin !== "native_live" || existing.lifecycleStatus !== "active")) throw fail("NATIVE_CONVERSATION_NOT_FOUND");
    const source = existing?.providerMetadata.nativeSessionSource as SourceIndex | undefined;
    if (existing && !source) throw fail("NATIVE_SOURCE_BINDING_REQUIRED");
    if (source && (source.schemaVersion !== 1 || source.sessionId !== p.sessionId || source.effectiveWorkingDirectory !== input.effectiveWorkingDirectory)) throw fail("EXPLICIT_BRANCH_SELECTION_REQUIRED");
    await tx.execute(sql`SELECT ${providerSessionOwnershipLock({ providerSessionId: p.sessionId, wait: true })}`);
    const otherOwners = await tx.execute(sql`SELECT id FROM conversations WHERE id <> ${input.conversationId}::uuid
      AND origin = 'native_live' AND lifecycle_status = 'active'
      AND provider_metadata->'nativeSessionSource'->>'sessionId' = ${p.sessionId} LIMIT 1`);
    if (otherOwners.length) throw fail("NATIVE_SESSION_ALREADY_ATTACHED");
    const activeTurns = await tx.select({ id: nativeLiveTurnPreparations.id }).from(nativeLiveTurnPreparations).where(inFlightConversationTurns(input)).limit(1);
    const compacts = await tx.select({ id: nativeLiveManualCompactions.id }).from(nativeLiveManualCompactions).where(and(
      eq(nativeLiveManualCompactions.userId, input.userId), eq(nativeLiveManualCompactions.conversationId, input.conversationId),
      inArray(nativeLiveManualCompactions.status, ["pending", "reserved"]),
    )).limit(1);
    if (activeTurns.length || compacts.length) throw fail("NATIVE_CONVERSATION_BUSY");
    if (source && (source.messages.length > p.messages.length || source.messages.some((old, i) => old.sourceMessageId !== p.messages[i]?.sourceMessageId))) throw fail("EXPLICIT_BRANCH_SELECTION_REQUIRED");
    if (source?.messages.some((old, i) => old.fingerprint !== p.messages[i]?.fingerprint)) throw fail("NATIVE_HISTORY_REWRITTEN");
    const unchanged = existing?.currentHeadMessageId === source?.headMessageId && source?.revision === p.revision && source.checkpointId === p.checkpointId && source.messages.length === p.messages.length;

    const allRows = await tx.select().from(conversationMessages).where(and(eq(conversationMessages.userId, input.userId), eq(conversationMessages.conversationId, input.conversationId)));
    const byId = new Map(allRows.map(row => [row.id, row]));
    const rows: typeof allRows = [];
    const visited = new Set<string>();
    let cursor = existing?.currentHeadMessageId ?? null;
    while (cursor !== null) {
      const row = byId.get(cursor);
      if (!row || visited.has(cursor) || row.status !== "completed") throw fail("CANONICAL_HEAD_CHANGED");
      visited.add(cursor); rows.push(row); cursor = row.parentMessageId;
    }
    rows.reverse();
    const indexedCount = source?.messages.length ?? 0;
    if (rows.length > p.messages.length || rows.length < indexedCount ||
      (source && rows[indexedCount - 1]?.id !== source.headMessageId)) throw fail("CANONICAL_HEAD_CHANGED");
    for (const [i, row] of rows.entries()) {
      const message = p.messages[i]!;
      if (row.role !== message.role) throw fail("CANONICAL_HEAD_CHANGED");
      if (i < indexedCount) {
        if (row.sourceMessageId !== source!.messages[i]!.sourceMessageId) throw fail("CANONICAL_HISTORY_CHANGED");
      } else if (row.role === "user" && row.id !== message.sourceMessageId) {
        // SDK sends canonical user UUIDs. Never adopt by matching text.
        throw fail("CANONICAL_HEAD_CHANGED");
      }
    }
    const checkpoints = await tx.select().from(conversationProviderSessionCheckpoints).where(and(
      eq(conversationProviderSessionCheckpoints.userId, input.userId), eq(conversationProviderSessionCheckpoints.conversationId, input.conversationId),
    ));
    const checkpointByMessage = new Map(checkpoints.map(cp => [cp.canonicalMessageId, cp]));
    const assistants = rows.flatMap((row, i) => row.role === "assistant" ? [{ row, message: p.messages[i]! }] : []);
    if (assistants.some(({ row, message }) => {
      const cp = checkpointByMessage.get(row.id);
      return !cp || cp.provider !== "claude_code" || cp.providerSessionId !== p.sessionId ||
        !sameCompletedTurnCheckpoint(cp.providerCheckpointId, message.providerCheckpointId, p.sessionId, snapshot?.entries)
        || cp.effectiveWorkingDirectory !== input.effectiveWorkingDirectory;
    })) throw fail("CANONICAL_CHECKPOINT_CHANGED");
    if (!unchanged && (input.expectedRevision !== (source?.revision ?? null) || input.expectedHeadMessageId !== (existing?.currentHeadMessageId ?? null))) throw fail("STALE_NATIVE_PROJECTION");
    if (snapshot) {
      const store = new DrizzleNativeLiveProviderSessionStoreRepository(tx);
      await store.preserveExternalSession({ userId: input.userId, sessionId: p.sessionId });
      await store.synchronizeNativeSnapshot({ userId: input.userId, key: { sessionId: p.sessionId }, entries: snapshot.entries });
    }
    if (unchanged) {
      if (source!.owner === "desktop") await tx.update(conversations).set({ providerMetadata: {
        ...existing!.providerMetadata, nativeSessionSource: { ...source, owner: "leileios" },
      }, updatedAt: new Date() }).where(eq(conversations.id, input.conversationId));
      return { outcome: "already_current" as const, conversationId: input.conversationId, headMessageId: source!.headMessageId, inserted: 0 };
    }

    // Nested transaction is a savepoint: source protection and projection roll back together.
    await new DrizzleNativeLiveProviderSessionStoreRepository(tx).preserveExternalSession({ userId: input.userId, sessionId: p.sessionId });
    if (!existing) await tx.insert(conversations).values({ id: input.conversationId, userId: input.userId, origin: "native_live", lifecycleStatus: "active" });
    // Adopt only identity-proven completed local rows; preserve bodies, dates and parents.
    for (let index = indexedCount; index < rows.length; index++) {
      await tx.update(conversationMessages).set({ sourceMessageId: p.messages[index]!.sourceMessageId,
        isCurrentPath: true, currentPathIndex: index }).where(eq(conversationMessages.id, rows[index]!.id));
    }
    let parent = rows.at(-1)?.id ?? null;
    for (let index = rows.length; index < p.messages.length; index++) {
      const message = p.messages[index]!;
      const id = randomUUID();
      const sourceDate = message.createdAt === null ? null : new Date(message.createdAt);
      await tx.insert(conversationMessages).values({
        id, userId: input.userId, conversationId: input.conversationId, parentMessageId: parent,
        sourceMessageId: message.sourceMessageId, role: message.role, status: "completed",
        sourceCreatedAt: sourceDate, createdAt: sourceDate ?? new Date(), isCurrentPath: true, currentPathIndex: index,
        completedAt: sourceDate ?? new Date(), displayText: message.blocks.filter(b => b.kind === "text").map(b => b.text ?? "").join("\n"),
      });
      if (message.blocks.length) await tx.insert(conversationContentBlocks).values(message.blocks.map((block, ordinal) => ({
        userId: input.userId, messageId: id, ordinal,
        kind: storedContentKind(block.kind), rawType: block.rawType ?? block.kind,
        text: block.text ?? null, payload: storedContentPayload(block.kind, block.payload ?? null),
      })));
      if (message.role === "assistant") await tx.insert(conversationProviderSessionCheckpoints).values({
        userId: input.userId, conversationId: input.conversationId, canonicalMessageId: id, provider: "claude_code",
        providerSessionId: p.sessionId, providerCheckpointId: message.providerCheckpointId,
        effectiveWorkingDirectory: input.effectiveWorkingDirectory,
        runtimeMetadata: { native_source_message_id: message.sourceMessageId, source_entry_uuids: message.sourceEntryUuids, parent_provider_checkpoint_id: message.parentProviderCheckpointId },
      });
      parent = id;
    }
    if (!parent) throw fail("INVALID_NATIVE_PROJECTION");
    const nextSource: SourceIndex = { schemaVersion: 1, sessionId: p.sessionId, revision: p.revision, checkpointId: p.checkpointId,
      owner: "leileios",
      effectiveWorkingDirectory: input.effectiveWorkingDirectory, headMessageId: parent,
      messages: p.messages.map(m => ({ sourceMessageId: m.sourceMessageId, fingerprint: m.fingerprint })) };
    await tx.update(conversations).set({ currentHeadMessageId: parent, updatedAt: new Date(), providerMetadata: { ...existing?.providerMetadata, nativeSessionSource: nextSource } }).where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, input.userId)));
    return { outcome: "restored" as const, conversationId: input.conversationId, headMessageId: parent, inserted: p.messages.length - rows.length };
  });
}

/** Explicit internal handoff after local release and durable snapshot sync. */
export async function releaseNativeSessionToDesktop(db: Database, input: {
  userId: string; conversationId: string; sessionId: string;
  expectedHeadMessageId: string; expectedRevision: string; expectedCheckpointId: string;
}) {
  if (![input.userId, input.conversationId, input.sessionId, input.expectedHeadMessageId, input.expectedCheckpointId].every(value => uuid.test(value))
    || !hash.test(input.expectedRevision)) throw fail("INVALID_NATIVE_PROJECTION");
  return db.transaction(async tx => {
    const [conversation] = await tx.select().from(conversations).where(and(
      eq(conversations.id, input.conversationId), eq(conversations.userId, input.userId),
    )).for("update");
    const source = conversation?.providerMetadata.nativeSessionSource as SourceIndex | undefined;
    if (!conversation || conversation.origin !== "native_live" || conversation.lifecycleStatus !== "active" || !source
      || source.sessionId !== input.sessionId) throw fail("NATIVE_SOURCE_BINDING_REQUIRED");
    await tx.execute(sql`SELECT ${providerSessionOwnershipLock({ providerSessionId: input.sessionId, wait: true })}`);
    const turns = await tx.select({ id: nativeLiveTurnPreparations.id }).from(nativeLiveTurnPreparations).where(inFlightConversationTurns(input)).limit(1);
    const compacts = await tx.select({ id: nativeLiveManualCompactions.id }).from(nativeLiveManualCompactions).where(and(
      eq(nativeLiveManualCompactions.userId, input.userId), eq(nativeLiveManualCompactions.conversationId, input.conversationId),
      inArray(nativeLiveManualCompactions.status, ["pending", "reserved"]),
    )).limit(1);
    if (turns.length || compacts.length) throw fail("NATIVE_CONVERSATION_BUSY");
    if (conversation.currentHeadMessageId !== input.expectedHeadMessageId || source.headMessageId !== input.expectedHeadMessageId
      || source.revision !== input.expectedRevision || source.checkpointId !== input.expectedCheckpointId) throw fail("STALE_NATIVE_PROJECTION");
    const [checkpoint] = await tx.select().from(conversationProviderSessionCheckpoints).where(and(
      eq(conversationProviderSessionCheckpoints.userId, input.userId), eq(conversationProviderSessionCheckpoints.conversationId, input.conversationId),
      eq(conversationProviderSessionCheckpoints.canonicalMessageId, input.expectedHeadMessageId),
    ));
    const store = new DrizzleNativeLiveProviderSessionStoreRepository(tx);
    // The synchronized durable snapshot, not a caller-supplied alias, proves the receipt.
    const entries = checkpoint?.providerCheckpointId === input.expectedCheckpointId ? undefined
      : await store.load({ userId: input.userId, key: { sessionId: input.sessionId } });
    if (!checkpoint || checkpoint.providerSessionId !== input.sessionId
      || !sameCompletedTurnCheckpoint(checkpoint.providerCheckpointId, input.expectedCheckpointId, input.sessionId, entries ?? undefined)
      || checkpoint.effectiveWorkingDirectory !== source.effectiveWorkingDirectory) throw fail("CANONICAL_CHECKPOINT_CHANGED");
    if (await new DrizzleNativeLiveProviderSessionStoreRepository(tx).getStatus({ userId: input.userId, sessionId: input.sessionId }) !== "complete") {
      throw fail("NATIVE_SESSION_RECOVERY_REQUIRED");
    }
    await tx.update(conversations).set({ providerMetadata: { ...conversation.providerMetadata,
      nativeSessionSource: { ...source, owner: "desktop" } }, updatedAt: new Date() }).where(eq(conversations.id, input.conversationId));
    return { owner: "desktop" as const, conversationId: input.conversationId, providerSessionId: input.sessionId,
      providerCheckpointId: input.expectedCheckpointId, headMessageId: input.expectedHeadMessageId };
  });
}

/** CAS evidence only. No history body, credentials or execution authority. */
export async function readNativeSessionRestoreState(db: Database, input: { userId: string; conversationId: string; sessionId: string }) {
  if (![input.userId, input.conversationId, input.sessionId].every(value => uuid.test(value))) throw fail("INVALID_NATIVE_PROJECTION");
  const [conversation] = await db.select().from(conversations).where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, input.userId)));
  if (!conversation) return { expectedHeadMessageId: null, expectedRevision: null };
  const source = conversation.providerMetadata.nativeSessionSource as SourceIndex | undefined;
  if (conversation.origin !== "native_live" || conversation.lifecycleStatus !== "active" || !source || source.sessionId !== input.sessionId) throw fail("NATIVE_SOURCE_BINDING_REQUIRED");
  return { expectedHeadMessageId: conversation.currentHeadMessageId, expectedRevision: source.revision };
}
