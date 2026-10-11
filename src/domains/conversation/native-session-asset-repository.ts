import { nativeDisplayAssetRevision, nativeSourceSessions } from "./native-session-history-repository.js";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { conversations, conversationMessages, conversationContentBlocks, conversationAttachments, nativeLiveChatAttachments, nativeLiveTurnPreparations, nativeLiveManualCompactions } from "../../database/schema.js";
import { DrizzleNativeLiveProviderSessionStoreRepository } from "../bridge/provider-session/native-live-provider-session-store.js";
import { inFlightConversationTurns } from "./native-live-conversation-repository.js";

type Database = ReturnType<typeof createDatabase>["db"];
export type NativeSessionAssetInput = {
  userId: string; conversationId: string; sessionId: string; expectedRevision: string;
  sourceEntryUuid: string; sourceBlockOrdinal: number; attachmentId?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code: string) => Object.assign(new Error(code), { code });
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Resolve/bind one original asset. No native write, URL fetch, model call or message insertion. */
export async function nativeSessionAsset(db: Database, input: NativeSessionAssetInput) {
  if (![input.userId, input.conversationId, input.sessionId, input.sourceEntryUuid].every(id => uuid.test(id))
    || (input.attachmentId !== undefined && !uuid.test(input.attachmentId)) || !/^[a-f0-9]{64}$/.test(input.expectedRevision)
    || !Number.isSafeInteger(input.sourceBlockOrdinal) || input.sourceBlockOrdinal < 0) throw fail("INVALID_NATIVE_ASSET");
  return db.transaction(async tx => {
    const [conversation] = await tx.select().from(conversations).where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, input.userId))).for("update");
    const source = record(conversation?.providerMetadata.nativeSessionSource);
    if (!conversation || conversation.lifecycleStatus !== "active" || conversation.origin !== "native_live" || source?.sessionId !== input.sessionId) throw fail("NATIVE_SOURCE_BINDING_REQUIRED");
    if (source.revision !== input.expectedRevision) throw fail("STALE_NATIVE_PROJECTION");
    if (source.owner === "desktop") throw fail("NATIVE_CONVERSATION_BUSY");
    const turns = await tx.select({ id: nativeLiveTurnPreparations.id }).from(nativeLiveTurnPreparations).where(inFlightConversationTurns(input)).limit(1);
    const compacts = await tx.select({ id: nativeLiveManualCompactions.id }).from(nativeLiveManualCompactions).where(and(eq(nativeLiveManualCompactions.userId, input.userId), eq(nativeLiveManualCompactions.conversationId, input.conversationId), inArray(nativeLiveManualCompactions.status, ["pending", "reserved"]))).limit(1);
    if (turns.length || compacts.length) throw fail("NATIVE_CONVERSATION_BUSY");
    const blocks = await tx.select({ block: conversationContentBlocks, sourceMessageId: conversationMessages.sourceMessageId, role: conversationMessages.role }).from(conversationContentBlocks).innerJoin(conversationMessages, eq(conversationContentBlocks.messageId, conversationMessages.id)).where(and(eq(conversationMessages.conversationId, input.conversationId), eq(conversationMessages.userId, input.userId)));
    // Blocks keep the session that first projected them; a continued session reuses them.
    const sessions = nativeSourceSessions(source as { sessionId: string; lineage?: string[] });
    const matches = blocks.filter(({ block }) => sessions.has(String(block.payload?.source_session_id)) && block.payload?.source_entry_uuid === input.sourceEntryUuid && block.payload.source_block_ordinal === input.sourceBlockOrdinal);
    if (matches.length > 1) throw fail("NATIVE_ASSET_UNAVAILABLE");
    let block = matches[0]?.block;
    const store = new DrizzleNativeLiveProviderSessionStoreRepository(tx);
    if (await store.getStatus({ userId: input.userId, sessionId: input.sessionId }) !== "complete") throw fail("NATIVE_SESSION_RECOVERY_REQUIRED");
    const entries = await store.load({ userId: input.userId, key: { sessionId: input.sessionId } });
    const displayAssets = typeof source.displayAssetsRevision === "string" && /^[a-f0-9]{64}$/.test(source.displayAssetsRevision)
      ? await store.load({ userId: input.userId, key: { sessionId: input.sessionId, subpath: `native-history-assets/${source.displayAssetsRevision}` } }) : null;
    if (displayAssets && nativeDisplayAssetRevision(displayAssets) !== source.displayAssetsRevision) throw fail("NATIVE_ASSET_MISMATCH");
    const entry = entries?.find(e => e.uuid === input.sourceEntryUuid && !e.isSidechain)
      ?? displayAssets?.find(e => e.uuid === input.sourceEntryUuid && !e.isSidechain);
    const content = record(entry?.message)?.content;
    const raw = record(Array.isArray(content) ? content[input.sourceBlockOrdinal] : null);
    const asset = record(raw?.source);
    if (!["image", "document"].includes(String(raw?.type)) || asset?.type !== "base64") throw fail("NATIVE_ASSET_UNAVAILABLE");
    if (block && createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(asset).sort(([a], [b]) => a.localeCompare(b))))).digest("hex") !== block.payload?.source_asset_hash) throw fail("NATIVE_ASSET_MISMATCH");
    const data = asset.data, mimeType = asset.media_type;
    // Native snapshot entries are bounded to 24 MiB. Never read local paths or fetch source URLs.
    if (typeof data !== "string" || data.length > 24 * 1024 * 1024 || !data.length || typeof mimeType !== "string"
      || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw fail("INVALID_NATIVE_ASSET");
    const bytes = Buffer.from(data, "base64");
    if (bytes.toString("base64") !== data) throw fail("INVALID_NATIVE_ASSET");
    const sha256 = createHash("sha256").update(bytes).digest("hex"), sizeBytes = bytes.length;
    const kind = raw!.type === "image" ? "image" as const : "file" as const;
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "application/pdf": "pdf" } as Record<string, string>)[mimeType] ?? "bin";
    const filename = `native-${input.sourceEntryUuid}-${input.sourceBlockOrdinal}.${extension}`;
    // LeileiOS-origin messages already have owned ordinary attachments. Reuse
    // only an exact byte descriptor under the native user UUID; never by text.
    if (!block) {
      const existing = blocks.filter(candidate => candidate.role === "user" && candidate.sourceMessageId === input.sourceEntryUuid
        && candidate.block.kind === "attachment" && candidate.block.payload?.sha256 === sha256
        && candidate.block.payload.size_bytes === sizeBytes && candidate.block.payload.mime_type === mimeType
        && candidate.block.payload.kind === kind);
      if (existing.length !== 1) throw fail("NATIVE_ASSET_UNAVAILABLE");
      block = existing[0]!.block;
    }
    const existingId = typeof block.payload?.attachment_id === "string" ? block.payload.attachment_id : null;
    const id = existingId ?? input.attachmentId;
    if (!id) return { attachmentId: null, filename, mimeType, sizeBytes, sha256, kind };
    const [candidate] = await tx.select({ objectKey: nativeLiveChatAttachments.objectKey }).from(nativeLiveChatAttachments).where(and(eq(nativeLiveChatAttachments.id, id), eq(nativeLiveChatAttachments.userId, input.userId)));
    if (!candidate) throw fail("NATIVE_ASSET_MISMATCH");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.objectKey}, 0))`);
    const [attachment] = await tx.select().from(nativeLiveChatAttachments).where(and(eq(nativeLiveChatAttachments.id, id), eq(nativeLiveChatAttachments.userId, input.userId))).for("update");
    if (!attachment || attachment.sizeBytes !== sizeBytes || attachment.sha256 !== sha256 || attachment.mimeType !== mimeType || attachment.kind !== kind
      || (existingId ? attachment.status !== "bound" || attachment.boundMessageId !== block.messageId
        : attachment.status !== "ready" || attachment.expiresAt.getTime() <= Date.now())) throw fail("NATIVE_ASSET_MISMATCH");
    if (!existingId) {
      const now = new Date();
      const descriptor = { attachment_id: id, filename: attachment.filename, mime_type: mimeType, size_bytes: sizeBytes, sha256, kind, storage: "native_live_attachment" };
      await tx.update(nativeLiveChatAttachments).set({ status: "bound", boundMessageId: block.messageId, boundAt: now, updatedAt: now }).where(eq(nativeLiveChatAttachments.id, id));
      await tx.insert(conversationAttachments).values({ userId: input.userId, messageId: block.messageId, ordinal: block.ordinal, sourceAttachmentId: id, name: attachment.filename, mimeType, sizeBytes, payload: descriptor });
      await tx.update(conversationContentBlocks).set({ kind: "attachment", payload: { ...block.payload, ...descriptor,
        schema_version: 1, identity: "attachment", refs: [{ type: "attachment_ref", entity_id: id }], materialization: "materialized",
        provenance: { provider: "claude_code", raw_type: block.rawType, origin: "native_session_restore", source_ref: { type: "attachment_ref", entity_id: id } },
      } }).where(eq(conversationContentBlocks.id, block.id));
    }
    return { attachmentId: id, filename: attachment.filename, mimeType, sizeBytes, sha256, kind };
  });
}
