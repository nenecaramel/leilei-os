import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { conversationProviderSessionCheckpoints, nativeLiveProviderSessionEntries } from "../../database/schema.js";
import type { NativeLiveMessage, NativeLiveMessageActivity } from "./native-live-conversation-types.js";

type Database = ReturnType<typeof createDatabase>["db"];
type MessageKey = { id: string; role: string; sourceMessageId: string | null; createdAt: string };
type NativeEntry = Record<string, unknown>;
type Event = NativeLiveMessageActivity["events"][number];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read-only historical display adapter. The native transcript remains
 * authoritative for imported/synced provider content; completed canonical
 * messages and their sync fingerprints must never be rewritten for display.
 * Only explicit, nonempty top-level Claude thinking text may be surfaced.
 * No signatures, redacted blocks, deltas, tool payloads or sidechains cross.
 */
export function projectNativeSessionVisibleThinking(
  entries: ReadonlyMap<string, NativeEntry>,
  input: { sourceEntryUuids: readonly string[]; providerSessionId: string; fallbackTime: string },
): Event[] {
  const events: Event[] = [];
  const seen = new Set<string>();
  for (const sourceUuid of input.sourceEntryUuids) {
    if (events.length >= 12) break;
    if (!uuid.test(sourceUuid) || !seen.add(sourceUuid)) continue;
    const entry = entries.get(sourceUuid);
    if (!entry || entry.uuid !== sourceUuid || entry.type !== "assistant"
      || entry.isSidechain === true || entry.isMeta === true || entry.isCompactSummary === true
      || entry.parent_tool_use_id || entry.parent_agent_id) continue;
    const content = (entry.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    const createdAt = typeof entry.timestamp === "string"
      && Number.isFinite(Date.parse(entry.timestamp)) ? entry.timestamp : input.fallbackTime;
    for (const [index, raw] of content.entries()) {
      if (events.length >= 12) break;
      const block = raw as Record<string, unknown> | null;
      if (!block || block.type !== "thinking" || typeof block.thinking !== "string"
        || !block.thinking.trim()) continue;
      events.push({
        sequence: events.length + 1,
        createdAt,
        event: {
          type: "runtime",
          provider_session_id: input.providerSessionId,
          payload: { kind: "user_visible_thinking", text: block.thinking.slice(0, 8_000),
            source_uuid: sourceUuid, content_index: index },
        },
      });
    }
  }
  return events;
}

/**
 * The checkpoint binds an imported assistant message to exact native entry
 * UUIDs. Only those entries, in the same owner/session and root subpath,
 * can become ephemeral display events. Regular live turns have no import
 * source-entry evidence, so this adapter never changes their activity.
 */
export async function readNativeSessionVisibleThinkingByAssistant(
  db: Database,
  input: { userId: string; conversationId: string; messageRows: MessageKey[] },
): Promise<Map<string, Event[]>> {
  const output = new Map<string, Event[]>();
  const assistants = input.messageRows.filter(row => row.role === "assistant" && row.sourceMessageId && uuid.test(row.id));
  if (assistants.length === 0) return output;
  const rowById = new Map(assistants.map(row => [row.id, row]));
  const checkpoints = await db.select({
    canonicalMessageId: conversationProviderSessionCheckpoints.canonicalMessageId,
    providerSessionId: conversationProviderSessionCheckpoints.providerSessionId,
    runtimeMetadata: conversationProviderSessionCheckpoints.runtimeMetadata,
  }).from(conversationProviderSessionCheckpoints).where(and(
    eq(conversationProviderSessionCheckpoints.userId, input.userId),
    eq(conversationProviderSessionCheckpoints.conversationId, input.conversationId),
    eq(conversationProviderSessionCheckpoints.provider, "claude_code"),
    inArray(conversationProviderSessionCheckpoints.canonicalMessageId, assistants.map(row => row.id)),
  ));
  const claims = new Map<string, Array<{ messageId: string; sourceEntryUuids: string[]; fallbackTime: string }>>();
  for (const checkpoint of checkpoints) {
    const row = rowById.get(checkpoint.canonicalMessageId);
    const metadata = checkpoint.runtimeMetadata;
    if (!row || !metadata || metadata.native_source_message_id !== row.sourceMessageId
      || !Array.isArray(metadata.source_entry_uuids)) continue;
    const sourceEntryUuids = metadata.source_entry_uuids;
    if (sourceEntryUuids.length === 0 || sourceEntryUuids.length > 256
      || sourceEntryUuids[0] !== row.sourceMessageId
      || sourceEntryUuids.some(id => typeof id !== "string" || !uuid.test(id))) continue;
    const claimsForSession = claims.get(checkpoint.providerSessionId) ?? [];
    claimsForSession.push({ messageId: row.id, sourceEntryUuids, fallbackTime: row.createdAt });
    claims.set(checkpoint.providerSessionId, claimsForSession);
  }
  for (const [providerSessionId, group] of claims) {
    const sourceUuids = [...new Set(group.flatMap(item => item.sourceEntryUuids))];
    if (sourceUuids.length === 0 || sourceUuids.length > 2_000) continue;
    const stored = await db.select({ entry: nativeLiveProviderSessionEntries.entry })
      .from(nativeLiveProviderSessionEntries).where(and(
        eq(nativeLiveProviderSessionEntries.userId, input.userId),
        eq(nativeLiveProviderSessionEntries.providerSessionId, providerSessionId),
        eq(nativeLiveProviderSessionEntries.subpath, ""),
        inArray(sql<string>`${nativeLiveProviderSessionEntries.entry} ->> 'uuid'`, sourceUuids),
      )).orderBy(asc(nativeLiveProviderSessionEntries.id));
    const byUuid = new Map<string, NativeEntry>();
    for (const { entry } of stored) {
      if (entry && typeof entry.uuid === "string" && !byUuid.has(entry.uuid)) {
        byUuid.set(entry.uuid, entry);
      }
    }
    for (const item of group) {
      const events = projectNativeSessionVisibleThinking(byUuid, {
        sourceEntryUuids: item.sourceEntryUuids, providerSessionId, fallbackTime: item.fallbackTime,
      });
      if (events.length) output.set(item.messageId, events);
    }
  }
  return output;
}
