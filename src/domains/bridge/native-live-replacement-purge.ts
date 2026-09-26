import type {
  NativeLiveConversation,
  NativeLiveMessage,
} from "../conversation/native-live-conversation-types.js";

export type ReplacementPurgePlan = {
  targetUserMessageId: string;
  branchParentMessageId: string | null;
  rootMessageIds: string[];
  messageIds: string[];
};

export function planReplacementMessagePurge(input: {
  operation: "send" | "retry" | "edit";
  conversation: NativeLiveConversation;
  targetUserMessageId: string | null;
}): ReplacementPurgePlan | null {
  if (input.operation === "send") return null;
  const targetId = input.targetUserMessageId?.trim();
  if (!targetId) return null;

  const target = input.conversation.messages.find(
    (message) => message.id === targetId && message.role === "user",
  );
  if (!target) return null;

  const currentPathIds = new Set(
    pathToHead(input.conversation).map((message) => message.id),
  );
  if (!currentPathIds.has(target.id)) return null;

  const roots =
    input.operation === "edit"
      ? [target.id]
      : input.conversation.messages
          .filter((message) => message.parentMessageId === target.id)
          .map((message) => message.id);

  const messageIds = collectDescendants(
    input.conversation.messages,
    roots,
  );

  return {
    targetUserMessageId: target.id,
    branchParentMessageId: target.parentMessageId,
    rootMessageIds: roots,
    messageIds,
  };
}

export function stateReferencesAnyId(
  value: unknown,
  ids: ReadonlySet<string>,
): boolean {
  if (typeof value === "string") return ids.has(value);
  if (Array.isArray(value)) {
    return value.some((item) => stateReferencesAnyId(item, ids));
  }
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some((item) =>
    stateReferencesAnyId(item, ids)
  );
}

export function planCausalSubjectStatePurge(input: {
  conversationId: string;
  purgeMessageIds: ReadonlySet<string>;
  resetDistillation: boolean;
  states: readonly {
    id: string;
    kind: string;
    payload: Record<string, unknown> | null;
    envelope: Record<string, unknown>;
    scopeConversationId: string | null;
    scopePathHeadMessageId: string | null;
  }[];
}): string[] {
  const contaminated = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;
    const references = new Set<string>([
      ...input.purgeMessageIds,
      ...contaminated,
    ]);

    for (const state of input.states) {
      if (contaminated.has(state.id)) continue;

      const distillationReset =
        input.resetDistillation
        && state.kind === "memory"
        && state.scopeConversationId === input.conversationId
        && state.payload?.formation === "distillation";

      const contaminatedByPath = Boolean(
        state.scopePathHeadMessageId
        && input.purgeMessageIds.has(state.scopePathHeadMessageId),
      );

      if (
        distillationReset
        || contaminatedByPath
        || stateReferencesAnyId(state.envelope, references)
        || stateReferencesAnyId(state.payload, references)
      ) {
        contaminated.add(state.id);
        changed = true;
      }
    }
  }

  return [...contaminated];
}

export function workflowReferencesAnyId(
  payload: Record<string, unknown> | null,
  ids: ReadonlySet<string>,
): boolean {
  return Boolean(payload) && stateReferencesAnyId(payload, ids);
}

function collectDescendants(
  messages: readonly NativeLiveMessage[],
  roots: readonly string[],
): string[] {
  const children = new Map<string, string[]>();
  for (const message of messages) {
    if (!message.parentMessageId) continue;
    const bucket = children.get(message.parentMessageId) ?? [];
    bucket.push(message.id);
    children.set(message.parentMessageId, bucket);
  }

  const result: string[] = [];
  const seen = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    queue.push(...(children.get(id) ?? []));
  }

  return result;
}

function pathToHead(
  conversation: NativeLiveConversation,
): NativeLiveMessage[] {
  if (!conversation.currentHeadMessageId) return [];
  const byId = new Map(
    conversation.messages.map((message) => [message.id, message]),
  );
  const reverse: NativeLiveMessage[] = [];
  const seen = new Set<string>();
  let currentId: string | null = conversation.currentHeadMessageId;

  while (currentId) {
    if (seen.has(currentId)) return [];
    seen.add(currentId);
    const message = byId.get(currentId);
    if (!message) return [];
    reverse.push(message);
    currentId = message.parentMessageId;
  }

  return reverse.reverse();
}
