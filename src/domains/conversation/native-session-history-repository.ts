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
  /** Incremental sync: the first `count` messages equal the server's synchronized prefix. */
  anchor?: { count: number; digest: string };
};
type SourceIndex = {
  schemaVersion: 1;
  sessionId: string;
  revision: string;
  checkpointId: string;
  effectiveWorkingDirectory: string;
  headMessageId: string;
  messages: Array<{ sourceMessageId: string; fingerprint: string; displayOnly?: boolean }>;
  /** 2: session-neutral (image/document blocks' session id blanked).
   *  3: also ignores the native parent pointer, which compaction rewrites for the preserved tail. */
  fingerprintVersion?: 2 | 3;
  displayAssetsRevision?: string;
  owner?: "leileios" | "desktop";
  /** Earlier native sessions this conversation continued from, oldest first. */
  lineage?: string[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
const fail = (code: string) => Object.assign(new Error(code), { code });

// Mirror the native reader's canonical JSON contract: JSONB can reorder keys.
export function nativeDisplayAssetRevision(entries: unknown): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value !== null && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
  return createHash("sha256").update(JSON.stringify(canonical(entries))).digest("hex");
}

export const nativeDisplayAssetSubpath = (revision: string) => `native-history-assets/${revision}`;

/** Fingerprint version 2: session-independent. Kept to compare sources stored with it. */
export const neutralFingerprintV2 = (message: NativeHistoryProjection["messages"][number]) => fingerprintForSession(message, "");

/** Fingerprint version 3 (stored): content only. Native compaction re-parents the
 * preserved tail under its summary, so the parent pointer is structure, not content. */
export function neutralFingerprint(message: NativeHistoryProjection["messages"][number]): string {
  const { parentProviderCheckpointId: _parent, ...rest } = message;
  return fingerprintForSession(rest as NativeHistoryProjection["messages"][number], "");
}
const storedFingerprint = (version: number | undefined, message: NativeHistoryProjection["messages"][number], sessionId: string) =>
  version === 3 ? neutralFingerprint(message) : version === 2 ? neutralFingerprintV2(message) : fingerprintForSession(message, sessionId);

/** Digest of a synchronized prefix, as `[sourceMessageId, neutral fingerprint]` pairs. */
export function nativeSyncDigest(messages: Array<{ sourceMessageId: string; fingerprint: string }>): string {
  return createHash("sha256").update(JSON.stringify(messages.map(m => [m.sourceMessageId, m.fingerprint]))).digest("hex");
}

/** Sessions whose records may back this conversation's canonical history. */
export function nativeSourceSessions(source: { sessionId: string; lineage?: string[] } | undefined): Set<string> {
  return new Set(source ? [...(source.lineage ?? []), source.sessionId] : []);
}

// Image/document blocks name the projecting session; the same native record in a
// continued session must compare equal to the fingerprint stored for the old one.
export function fingerprintForSession(message: NativeHistoryProjection["messages"][number], sessionId: string): string {
  const { fingerprint: _fingerprint, ...body } = message;
  const blocks = body.blocks.map(block => block.payload && typeof block.payload === "object" && "source_session_id" in block.payload
    ? { ...block, payload: { ...block.payload, source_session_id: sessionId } } : block);
  return createHash("sha256").update(JSON.stringify({ ...body, blocks })).digest("hex");
}

/** One display-asset carrier: a user/assistant record holding image or document bytes. */
export function validateNativeDisplayAssetEntry(entry: unknown, seen: Set<string>) {
  const value = entry as (Record<string, unknown> & { type?: unknown }) | null;
  const content = (value?.message as { content?: unknown[] } | undefined)?.content;
  if (!value || typeof value !== "object" || typeof value.uuid !== "string" || !uuid.test(value.uuid) || seen.has(value.uuid) ||
    !["user", "assistant"].includes(String(value.type)) || !Array.isArray(content) ||
    !content.some(block => block && typeof block === "object" && ["image", "document"].includes(String((block as { type?: unknown }).type)))) throw fail("INVALID_NATIVE_SNAPSHOT");
  seen.add(value.uuid);
}

/** Complete display-asset set: bounded, uniquely identified and matching its revision. */
export function validateNativeDisplayAssets(entries: unknown, revision: string) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 10_000 ||
    Buffer.byteLength(JSON.stringify(entries)) > 24 * 1024 * 1024 ||
    !hash.test(revision) || nativeDisplayAssetRevision(entries) !== revision) throw fail("INVALID_NATIVE_SNAPSHOT");
  const seen = new Set<string>();
  for (const entry of entries) validateNativeDisplayAssetEntry(entry, seen);
}

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
    p.messages.at(-1)?.providerCheckpointId !== p.checkpointId ||
    (p.anchor !== undefined && (!Number.isSafeInteger(p.anchor.count) || p.anchor.count < 1 || !hash.test(p.anchor.digest)))) throw fail("INVALID_NATIVE_PROJECTION");
  const snapshot = input.nativeSnapshot;
  // With entriesOffset, `entries` is only the tail after the server's stored records.
  if (snapshot && (snapshot.sessionId !== p.sessionId || snapshot.revision !== p.revision || !Array.isArray(snapshot.entries) ||
    (snapshot.entriesOffset !== undefined && (!Number.isSafeInteger(snapshot.entriesOffset) || snapshot.entriesOffset < 1)) ||
    (snapshot.entriesOffset === undefined && !snapshot.entries.some(entry => entry?.uuid === p.checkpointId)))) throw fail("INVALID_NATIVE_SNAPSHOT");

  const assets = snapshot?.displayAssets;
  if (assets) {
    // Staged form: bytes arrived earlier in small batches; verified in the transaction.
    if (assets.stagedCount !== undefined) {
      if (assets.entries !== undefined || !hash.test(assets.revision) || !Number.isSafeInteger(assets.stagedCount) ||
        assets.stagedCount < 1 || assets.stagedCount > 10_000) throw fail("INVALID_NATIVE_SNAPSHOT");
    } else validateNativeDisplayAssets(assets.entries, assets.revision);
  }

  const seen = new Set<string>();
  for (const [index, message] of p.messages.entries()) {
    const { fingerprint, ...body } = message;
    if (!uuid.test(message.sourceMessageId) || seen.has(message.sourceMessageId) ||
      !["user", "assistant"].includes(message.role) ||
      (index === 0 && p.anchor ? typeof message.parentSourceMessageId !== "string"
        : message.parentSourceMessageId !== (p.messages[index - 1]?.sourceMessageId ?? null)) ||
      !uuid.test(message.providerCheckpointId) ||
      (message.parentProviderCheckpointId !== null && !uuid.test(message.parentProviderCheckpointId)) ||
      !message.sourceEntryUuids.length || message.sourceEntryUuids.some(id => !uuid.test(id)) ||
      (message.createdAt !== null && !Number.isFinite(Date.parse(message.createdAt))) ||
      createHash("sha256").update(JSON.stringify(body)).digest("hex") !== fingerprint) throw fail("INVALID_NATIVE_PROJECTION");
    seen.add(message.sourceMessageId);
  }
}

// Historical image/document blocks not yet bound to an owned attachment, so a
// switch materializes only those instead of re-checking every asset.
async function pendingNativeAssets(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], input: { userId: string; conversationId: string }) {
  const rows = await tx.execute<{ source_entry_uuid: string; source_block_ordinal: number }>(sql`
    SELECT b.payload->>'source_entry_uuid' AS source_entry_uuid, (b.payload->>'source_block_ordinal')::int AS source_block_ordinal
    FROM conversation_content_blocks b JOIN conversation_messages m ON m.id = b.message_id
    WHERE m.user_id = ${input.userId}::uuid AND m.conversation_id = ${input.conversationId}::uuid
      AND b.kind IN ('image', 'file') AND b.payload ? 'source_entry_uuid'
    ORDER BY m.current_path_index NULLS LAST, b.ordinal LIMIT 5000`);
  return rows.map(row => ({ sourceEntryUuid: row.source_entry_uuid, sourceBlockOrdinal: row.source_block_ordinal }));
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
  nativeSnapshot?: { sessionId: string; revision: string; entries: Array<Record<string, unknown> & { type: string }>; entriesOffset?: number; displayAssets?: { revision: string; entries?: Array<Record<string, unknown> & { type: string }>; stagedCount?: number } };
}): Promise<{ outcome: "restored" | "already_current"; conversationId: string; headMessageId: string; inserted: number;
  pendingAssets: Array<{ sourceEntryUuid: string; sourceBlockOrdinal: number }> }> {
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
    if (source && (source.schemaVersion !== 1 || source.effectiveWorkingDirectory !== input.effectiveWorkingDirectory)) throw fail("EXPLICIT_BRANCH_SELECTION_REQUIRED");
    // A different native session may continue this conversation only if it carries
    // every synchronized message unchanged (checked below). Archived sessions never do.
    const continuation = source !== undefined && source.sessionId !== p.sessionId;
    if (continuation && source.lineage?.includes(p.sessionId)) throw fail("EXPLICIT_BRANCH_SELECTION_REQUIRED");
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
    // Staged display assets must be complete and exactly match the claimed revision.
    if (snapshot?.displayAssets?.stagedCount !== undefined) {
      const staged = await new DrizzleNativeLiveProviderSessionStoreRepository(tx).load({ userId: input.userId,
        key: { sessionId: p.sessionId, subpath: nativeDisplayAssetSubpath(snapshot.displayAssets.revision) } });
      if (staged?.length !== snapshot.displayAssets.stagedCount) throw fail("INVALID_NATIVE_SNAPSHOT");
      validateNativeDisplayAssets(staged, snapshot.displayAssets.revision);
    }
    // Incremental sync: rebuild the full native snapshot and message list from the
    // server's synchronized base. A changed base makes the client resend everything.
    let entries = snapshot?.entries;
    if (snapshot?.entriesOffset !== undefined) {
      const stored = await new DrizzleNativeLiveProviderSessionStoreRepository(tx).load({ userId: input.userId, key: { sessionId: p.sessionId } }) ?? [];
      if (stored.length !== snapshot.entriesOffset) throw fail("NATIVE_SYNC_BASE_CHANGED");
      entries = [...stored, ...snapshot.entries];
      if (!entries.some(entry => entry.uuid === p.checkpointId)) throw fail("INVALID_NATIVE_SNAPSHOT");
    }
    const offset = p.anchor?.count ?? 0;
    if (p.anchor && (!source || source.fingerprintVersion !== 3 || offset > source.messages.length
      || nativeSyncDigest(source.messages.slice(0, offset)) !== p.anchor.digest
      || p.messages[0]!.parentSourceMessageId !== source.messages[offset - 1]!.sourceMessageId)) throw fail("NATIVE_SYNC_BASE_CHANGED");
    // Messages before `offset` are the anchored, already-verified synchronized prefix.
    const total = offset + p.messages.length;
    const at = (i: number) => i < offset ? undefined : p.messages[i - offset];
    if (source && (source.messages.length > total || source.messages.some((old, i) => i >= offset && old.sourceMessageId !== at(i)?.sourceMessageId))) throw fail("EXPLICIT_BRANCH_SELECTION_REQUIRED");
    if (source?.messages.some((old, i) => i >= offset && old.fingerprint !== (source.fingerprintVersion === undefined && !continuation
      ? at(i)!.fingerprint : storedFingerprint(source.fingerprintVersion, at(i)!, source.sessionId)))) throw fail("NATIVE_HISTORY_REWRITTEN");
    const unchanged = !continuation && existing?.currentHeadMessageId === source?.headMessageId && source?.revision === p.revision && source.checkpointId === p.checkpointId && source.messages.length === total
      && source.displayAssetsRevision === snapshot?.displayAssets?.revision
      // A version-1 source is rewritten once with session-neutral fingerprints.
      && source.fingerprintVersion === 3;

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
    if (rows.length > total || rows.length < indexedCount ||
      (source && rows[indexedCount - 1]?.id !== source.headMessageId)) throw fail("CANONICAL_HEAD_CHANGED");
    for (const [i, row] of rows.entries()) {
      const message = at(i);
      if (message && row.role !== message.role) throw fail("CANONICAL_HEAD_CHANGED");
      if (i < indexedCount) {
        if (row.sourceMessageId !== source!.messages[i]!.sourceMessageId) throw fail("CANONICAL_HISTORY_CHANGED");
      } else if (row.role === "user" && row.id !== message!.sourceMessageId) {
        // SDK sends canonical user UUIDs. Never adopt by matching text.
        throw fail("CANONICAL_HEAD_CHANGED");
      }
    }
    const checkpoints = await tx.select().from(conversationProviderSessionCheckpoints).where(and(
      eq(conversationProviderSessionCheckpoints.userId, input.userId), eq(conversationProviderSessionCheckpoints.conversationId, input.conversationId),
    ));
    const checkpointByMessage = new Map(checkpoints.map(cp => [cp.canonicalMessageId, cp]));
    // The anchored prefix was verified when it was synchronized; check the rest.
    const assistants = rows.flatMap((row, i) => row.role === "assistant" && i >= offset ? [{ row, message: at(i)! }] : []);
    // LeileiOS may run unsynchronized turns in its own forks. Their checkpoint
    // session is acceptable when the restored session carries that exact record.
    const carried = new Set(entries?.flatMap(entry => typeof entry.uuid === "string" ? [entry.uuid] : []) ?? []);
    if (assistants.some(({ row, message }) => {
      const cp = checkpointByMessage.get(row.id);
      // Display-only historical records have no valid checkpoint in the
      // current SDK root. Do not invent one or silently enable exact rewind.
      const index = rows.indexOf(row);
      if (!cp && index < indexedCount && source?.messages[index]?.displayOnly === true && entries
        && !entries.some(entry => entry.uuid === message.providerCheckpointId)) return false;
      const isCarried = cp?.providerCheckpointId != null && carried.has(cp.providerCheckpointId);
      // Synchronized history was proven when fixed and its content by fingerprint. A
      // checkpoint of another session that this one does not carry (compaction,
      // rewind past it) stays historical; the restored session must carry its own.
      if (cp && index < indexedCount && !isCarried && cp.providerSessionId !== p.sessionId) return false;
      return !cp || cp.provider !== "claude_code" || !(cp.providerSessionId === p.sessionId || nativeSourceSessions(source).has(cp.providerSessionId) || isCarried) ||
        !sameCompletedTurnCheckpoint(cp.providerCheckpointId, message.providerCheckpointId, p.sessionId, entries)
        || cp.effectiveWorkingDirectory !== input.effectiveWorkingDirectory;
    })) throw fail("CANONICAL_CHECKPOINT_CHANGED");
    if (!unchanged && (input.expectedRevision !== (source?.revision ?? null) || input.expectedHeadMessageId !== (existing?.currentHeadMessageId ?? null))) throw fail("STALE_NATIVE_PROJECTION");
    if (snapshot) {
      const store = new DrizzleNativeLiveProviderSessionStoreRepository(tx);
      await store.preserveExternalSession({ userId: input.userId, sessionId: p.sessionId });
      await store.synchronizeNativeSnapshot({ userId: input.userId, key: { sessionId: p.sessionId }, entries: entries! });
      if (snapshot.displayAssets?.entries) await store.synchronizeNativeSnapshot({ userId: input.userId,
        key: { sessionId: p.sessionId, subpath: nativeDisplayAssetSubpath(snapshot.displayAssets.revision) }, entries: snapshot.displayAssets.entries });
    }
    // Point each checkpoint at the newest session that carries its exact record,
    // so earlier transcripts stop being needed for Edit/Retry and can be archived.
    const movable = rows.flatMap(row => {
      const cp = checkpointByMessage.get(row.id);
      return cp && cp.providerSessionId !== p.sessionId && cp.providerCheckpointId !== null && carried.has(cp.providerCheckpointId) ? [cp.id] : [];
    });
    if (movable.length) await tx.update(conversationProviderSessionCheckpoints).set({ providerSessionId: p.sessionId })
      .where(inArray(conversationProviderSessionCheckpoints.id, movable));
    if (unchanged) {
      if (source!.owner === "desktop") await tx.update(conversations).set({ providerMetadata: {
        ...existing!.providerMetadata, nativeSessionSource: { ...source, owner: "leileios" },
      }, updatedAt: new Date() }).where(eq(conversations.id, input.conversationId));
      return { outcome: "already_current" as const, conversationId: input.conversationId, headMessageId: source!.headMessageId, inserted: 0,
        pendingAssets: await pendingNativeAssets(tx, input) };
    }

    // Nested transaction is a savepoint: source protection and projection roll back together.
    await new DrizzleNativeLiveProviderSessionStoreRepository(tx).preserveExternalSession({ userId: input.userId, sessionId: p.sessionId });
    if (!existing) await tx.insert(conversations).values({ id: input.conversationId, userId: input.userId, origin: "native_live", lifecycleStatus: "active" });
    // Adopt only identity-proven completed local rows; preserve bodies, dates and parents.
    for (let index = indexedCount; index < rows.length; index++) {
      await tx.update(conversationMessages).set({ sourceMessageId: at(index)!.sourceMessageId,
        isCurrentPath: true, currentPathIndex: index }).where(eq(conversationMessages.id, rows[index]!.id));
    }
    let parent = rows.at(-1)?.id ?? null;
    for (let index = rows.length; index < total; index++) {
      const message = at(index)!;
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
      if (message.role === "assistant" && (!entries || entries.some(entry => entry.uuid === message.providerCheckpointId))) await tx.insert(conversationProviderSessionCheckpoints).values({
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
      ...(snapshot?.displayAssets ? { displayAssetsRevision: snapshot.displayAssets.revision } : {}),
      ...(continuation ? { lineage: [...(source.lineage ?? []), source.sessionId].slice(-1000) } : source?.lineage ? { lineage: source.lineage } : {}),
      fingerprintVersion: 3,
      messages: Array.from({ length: total }, (_, i) => {
        if (i < offset) return source!.messages[i]!;
        const m = at(i)!;
        return { sourceMessageId: m.sourceMessageId, fingerprint: neutralFingerprint(m),
          ...(entries && !entries.some(entry => entry.uuid === m.providerCheckpointId) ? { displayOnly: true } : {}) };
      }) };
    await tx.update(conversations).set({ currentHeadMessageId: parent, updatedAt: new Date(), providerMetadata: { ...existing?.providerMetadata, nativeSessionSource: nextSource } }).where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, input.userId)));
    return { outcome: "restored" as const, conversationId: input.conversationId, headMessageId: parent, inserted: total - rows.length, pendingAssets: await pendingNativeAssets(tx, input) };
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
  if (conversation.origin !== "native_live" || conversation.lifecycleStatus !== "active" || !source
    || source.lineage?.includes(input.sessionId)) throw fail("NATIVE_SOURCE_BINDING_REQUIRED");
  // A different session is only a candidate continuation; restore verifies it.
  // Anchors let the client send only what follows the synchronized base.
  const stored = await new DrizzleNativeLiveProviderSessionStoreRepository(db).load({ userId: input.userId, key: { sessionId: input.sessionId } });
  return { expectedHeadMessageId: conversation.currentHeadMessageId, expectedRevision: source.revision,
    continuation: source.sessionId !== input.sessionId,
    ...(source.fingerprintVersion === 3 ? { messageAnchor: { count: source.messages.length, digest: nativeSyncDigest(source.messages) } } : {}),
    ...(stored?.length ? { entriesAnchor: { count: stored.length, digest: nativeDisplayAssetRevision(stored) } } : {}) };
}

/** Native sessions LeileiOS still needs on the Mac: checkpoints (resume/fork
 * targets), conversation sources and in-flight turns. Archival must keep them. */
export async function listReferencedNativeSessions(db: Database, input: { userId: string }) {
  if (!uuid.test(input.userId)) throw fail("INVALID_NATIVE_PROJECTION");
  const rows = await db.execute<{ id: string }>(sql`
    SELECT provider_session_id AS id FROM conversation_provider_session_checkpoints WHERE user_id = ${input.userId}::uuid AND provider = 'claude_code'
    UNION SELECT provider_metadata->'nativeSessionSource'->>'sessionId' FROM conversations
      WHERE user_id = ${input.userId}::uuid AND lifecycle_status = 'active' AND provider_metadata ? 'nativeSessionSource'
    UNION SELECT parent_provider_session_id FROM native_live_turn_preparations WHERE user_id = ${input.userId}::uuid AND status = 'prepared'
    UNION SELECT provider_session_id FROM native_live_turn_preparations WHERE user_id = ${input.userId}::uuid AND status = 'prepared'`);
  return { sessionIds: rows.map(row => row.id).filter((id): id is string => typeof id === "string" && uuid.test(id)).sort() };
}

/** Owner-scoped selector metadata only: no messages, prompt, assets or write lease. */
export async function listNativeSessionSwitchChoices(db: Database, input: { userId: string }) {
  if (!uuid.test(input.userId)) throw fail("INVALID_NATIVE_PROJECTION");
  const rows = await db.execute(sql`
    SELECT c.id AS "conversationId", c.title, c.updated_at AS "updatedAt",
      c.current_head_message_id AS "headMessageId", cp.provider_session_id AS "providerSessionId",
      cp.provider_checkpoint_id AS "providerCheckpointId",
      c.provider_metadata->'nativeSessionSource'->>'sessionId' AS "sourceSessionId",
      COALESCE(c.provider_metadata->'nativeSessionSource'->'lineage', '[]'::jsonb) AS "sourceLineage",
      EXISTS (SELECT 1 FROM native_live_turn_preparations t WHERE
        t.user_id = c.user_id AND t.conversation_id = c.id AND
        t.dispatch_status IN ('staged','pending','reserved','executing','delivery_unknown')) AS busy
    FROM conversations c LEFT JOIN conversation_provider_session_checkpoints cp
      ON cp.user_id = c.user_id AND cp.conversation_id = c.id
      AND cp.canonical_message_id = c.current_head_message_id AND cp.provider = 'claude_code'
    WHERE c.user_id = ${input.userId}::uuid AND c.origin = 'native_live' AND c.lifecycle_status = 'active'
    ORDER BY c.updated_at DESC, c.id LIMIT 1001`);
  return { conversations: rows.slice(0, 1000), truncated: rows.length > 1000 };
}
