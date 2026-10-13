import type {
  ExportConversationAttachmentRecord,
  ExportConversationContentBlockRecord,
  ExportConversationMessageRecord,
  ExportConversationProviderCheckpointRecord,
  ExportConversationsBundle,
} from "../export/export-types.js";
import { hashCanonical } from "./import-canonical.js";
import type {
  ConversationRestoreRecord,
  ImportClassification,
  ImportCurrentState,
  ImportPlanItem,
} from "./import-planner.js";

const emptyConversations = (): ExportConversationsBundle => ({
  conversations: [],
  messages: [],
  content_blocks: [],
  attachments: [],
  provider_checkpoints: [],
});

function classifyConversationEntity<T>(
  entity: ConversationRestoreRecord["entity"],
  imported: T[],
  current: T[],
  key: (record: T) => string,
): ImportPlanItem[] {
  const occurrences = new Map<string, number>();
  for (const record of imported) {
    const logicalKey = `${entity}:${key(record)}`;
    occurrences.set(
      logicalKey,
      (occurrences.get(logicalKey) ?? 0) + 1,
    );
  }

  return imported.map((record) => {
    const logicalKey = `${entity}:${key(record)}`;
    const existing = current.find(
      (candidate) => key(candidate) === key(record),
    );
    let classification: ImportClassification;

    if ((occurrences.get(logicalKey) ?? 0) > 1) {
      classification = "invalid";
    } else if (!existing) {
      classification = "create";
    } else if (hashCanonical(existing) === hashCanonical(record)) {
      classification = "duplicate";
    } else {
      classification = "conflict";
    }

    return {
      module: "conversations" as const,
      logical_key: logicalKey,
      classification,
      record: { entity, value: record } as ConversationRestoreRecord,
      current_hash: existing ? hashCanonical(existing) : null,
    };
  });
}

export function conversationItems(
  imported: ExportConversationsBundle,
  current: ImportCurrentState,
): ImportPlanItem[] {
  const currentConversations =
    current.conversations ?? emptyConversations();

  const conversationItems = classifyConversationEntity(
    "conversation",
    imported.conversations,
    currentConversations.conversations,
    (record) => record.id,
  );
  const messageItems = classifyConversationEntity(
    "message",
    imported.messages,
    currentConversations.messages,
    (record) => record.id,
  );
  const blockItems = classifyConversationEntity(
    "content_block",
    imported.content_blocks,
    currentConversations.content_blocks,
    (record) => record.id,
  );
  const attachmentItems = classifyConversationEntity(
    "attachment",
    imported.attachments,
    currentConversations.attachments,
    (record) => record.id,
  );
  const checkpointItems = classifyConversationEntity(
    "provider_checkpoint",
    imported.provider_checkpoints,
    currentConversations.provider_checkpoints,
    (record) =>
      `${record.conversation_id}:${record.canonical_message_id}:${record.provider}`,
  );
  const items = [
    ...conversationItems,
    ...messageItems,
    ...blockItems,
    ...attachmentItems,
    ...checkpointItems,
  ];

  const conversationIds = new Set([
    ...currentConversations.conversations.map((record) => record.id),
    ...imported.conversations.map((record) => record.id),
  ]);
  const messageById = new Map<string, ExportConversationMessageRecord>([
    ...currentConversations.messages.map(
      (record) => [record.id, record] as const,
    ),
    ...imported.messages.map(
      (record) => [record.id, record] as const,
    ),
  ]);

  for (const item of items) {
    if (item.classification !== "create") continue;
    const record = item.record as ConversationRestoreRecord;

    if (
      record.entity === "conversation"
      && current.foreign_conversation_ids?.has(record.value.id)
    ) {
      item.classification = "conflict";
      continue;
    }

    if (record.entity === "conversation") {
      const headId = record.value.current_head_message_id;
      if (headId) {
        const head = messageById.get(headId);
        if (!head || head.conversation_id !== record.value.id) {
          item.classification = "invalid";
        }
      }
      continue;
    }

    if (
      record.entity === "message"
      && current.foreign_conversation_message_ids?.has(record.value.id)
    ) {
      item.classification = "conflict";
      continue;
    }

    if (record.entity === "message") {
      if (!conversationIds.has(record.value.conversation_id)) {
        item.classification = "invalid";
        continue;
      }
      if (record.value.parent_message_id) {
        const parent = messageById.get(record.value.parent_message_id);
        if (
          !parent
          || parent.conversation_id !== record.value.conversation_id
          || parent.id === record.value.id
        ) {
          item.classification = "invalid";
        }
      }
      continue;
    }

    if (
      record.entity === "content_block"
      && current.foreign_conversation_content_block_ids?.has(record.value.id)
    ) {
      item.classification = "conflict";
      continue;
    }
    if (record.entity === "content_block") {
      if (!messageById.has(record.value.message_id)) {
        item.classification = "invalid";
      }
      continue;
    }

    if (
      record.entity === "attachment"
      && current.foreign_conversation_attachment_ids?.has(record.value.id)
    ) {
      item.classification = "conflict";
      continue;
    }
    if (record.entity === "attachment") {
      if (!messageById.has(record.value.message_id)) {
        item.classification = "invalid";
      }
      continue;
    }

    if (record.entity === "provider_checkpoint") {
      if (
        current.foreign_conversation_checkpoint_ids?.has(
          record.value.id,
        )
      ) {
        item.classification = "conflict";
        continue;
      }
      const message = messageById.get(
        record.value.canonical_message_id,
      );
      if (
        !conversationIds.has(record.value.conversation_id)
        || !message
        || message.conversation_id !== record.value.conversation_id
        || message.role !== "assistant"
        || message.status !== "completed"
      ) {
        item.classification = "invalid";
      }
    }
  }

  const importedMessageIds = new Set(
    imported.messages.map((record) => record.id),
  );
  const cycleIds = new Set<string>();
  for (const message of imported.messages) {
    const seen = new Set<string>();
    let currentId: string | null = message.id;
    while (currentId && importedMessageIds.has(currentId)) {
      if (seen.has(currentId)) {
        for (const id of seen) cycleIds.add(id);
        break;
      }
      seen.add(currentId);
      const currentMessage = messageById.get(currentId);
      currentId = currentMessage?.parent_message_id ?? null;
    }
  }
  if (cycleIds.size > 0) {
    for (const item of messageItems) {
      const record = item.record as ConversationRestoreRecord;
      if (
        record.entity === "message"
        && cycleIds.has(record.value.id)
      ) {
        item.classification = "invalid";
      }
    }
  }

  const currentPathKeys = new Map<string, string>();
  for (const message of currentConversations.messages) {
    if (
      message.is_current_path
      && message.current_path_index !== null
    ) {
      currentPathKeys.set(
        `${message.conversation_id}:${message.current_path_index}`,
        message.id,
      );
    }
  }
  const importedPathKeys = new Map<string, string>();
  for (const item of messageItems) {
    const record = (item.record as ConversationRestoreRecord).value as ExportConversationMessageRecord;
    if (
      !record.is_current_path
      || record.current_path_index === null
    ) continue;
    const key = `${record.conversation_id}:${record.current_path_index}`;
    const importedOwner = importedPathKeys.get(key);
    if (importedOwner && importedOwner !== record.id) {
      item.classification = "invalid";
      const previous = messageItems.find(
        (candidate) =>
          (candidate.record as ConversationRestoreRecord).entity === "message"
          && ((candidate.record as ConversationRestoreRecord).value as ExportConversationMessageRecord).id === importedOwner,
      );
      if (previous) previous.classification = "invalid";
    } else {
      importedPathKeys.set(key, record.id);
    }
    const currentOwner = currentPathKeys.get(key);
    if (
      item.classification === "create"
      && currentOwner
      && currentOwner !== record.id
    ) {
      item.classification = "conflict";
    }
  }

  const currentBlockOrdinals = new Map<string, string>(
    currentConversations.content_blocks.map(
      (record) => [
        `${record.message_id}:${record.ordinal}`,
        record.id,
      ] as const,
    ),
  );
  const importedBlockOrdinals = new Map<string, string>();
  for (const item of blockItems) {
    const record = (item.record as ConversationRestoreRecord).value as ExportConversationContentBlockRecord;
    const key = `${record.message_id}:${record.ordinal}`;
    const importedOwner = importedBlockOrdinals.get(key);
    if (importedOwner && importedOwner !== record.id) {
      item.classification = "invalid";
      const previous = blockItems.find(
        (candidate) =>
          (candidate.record as ConversationRestoreRecord).entity === "content_block"
          && ((candidate.record as ConversationRestoreRecord).value as ExportConversationContentBlockRecord).id === importedOwner,
      );
      if (previous) previous.classification = "invalid";
    } else {
      importedBlockOrdinals.set(key, record.id);
    }
    const currentOwner = currentBlockOrdinals.get(key);
    if (
      item.classification === "create"
      && currentOwner
      && currentOwner !== record.id
    ) {
      item.classification = "conflict";
    }
  }

  const currentAttachmentOrdinals = new Map<string, string>(
    currentConversations.attachments.map(
      (record) => [
        `${record.message_id}:${record.ordinal}`,
        record.id,
      ] as const,
    ),
  );
  const importedAttachmentOrdinals = new Map<string, string>();
  for (const item of attachmentItems) {
    const record = (item.record as ConversationRestoreRecord).value as ExportConversationAttachmentRecord;
    const key = `${record.message_id}:${record.ordinal}`;
    const importedOwner = importedAttachmentOrdinals.get(key);
    if (importedOwner && importedOwner !== record.id) {
      item.classification = "invalid";
      const previous = attachmentItems.find(
        (candidate) =>
          (candidate.record as ConversationRestoreRecord).entity === "attachment"
          && ((candidate.record as ConversationRestoreRecord).value as ExportConversationAttachmentRecord).id === importedOwner,
      );
      if (previous) previous.classification = "invalid";
    } else {
      importedAttachmentOrdinals.set(key, record.id);
    }
    const currentOwner = currentAttachmentOrdinals.get(key);
    if (
      item.classification === "create"
      && currentOwner
      && currentOwner !== record.id
    ) {
      item.classification = "conflict";
    }
  }

  const currentCheckpointIds = new Set(
    currentConversations.provider_checkpoints.map(
      (record) => record.id,
    ),
  );
  const importedCheckpointIds = new Map<string, number>();
  for (const record of imported.provider_checkpoints) {
    importedCheckpointIds.set(
      record.id,
      (importedCheckpointIds.get(record.id) ?? 0) + 1,
    );
  }
  for (const item of checkpointItems) {
    const record = (item.record as ConversationRestoreRecord).value as ExportConversationProviderCheckpointRecord;
    if ((importedCheckpointIds.get(record.id) ?? 0) > 1) {
      item.classification = "invalid";
      continue;
    }
    if (
      item.classification === "create"
      && currentCheckpointIds.has(record.id)
    ) {
      item.classification = "conflict";
    }
  }

  return items;
}

