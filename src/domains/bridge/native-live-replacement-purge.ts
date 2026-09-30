import {
  expandCausalStateReferences,
  structuredValueReferencesAnyId,
} from "../runtime/persistent-reference-scan.js";
import type {
  NativeLiveConversation,
  NativeLiveMessage,
} from "../conversation/native-live-conversation-types.js";
import {
  removeRecallReinforcementSources,
  type MemoryLifecyclePolicy,
} from "../runtime/memory-lifecycle.js";
import {
  readThoughtLifecycle,
  writeThoughtActive,
} from "../runtime/thought.js";

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

export {
  structuredValueReferencesAnyId as stateReferencesAnyId,
};

export function planCausalSubjectStatePurge(input: {
  purgeMessageIds: ReadonlySet<string>;
  states: readonly {
    id: string;
    kind: string;
    payload: Record<string, unknown> | null;
    envelope: Record<string, unknown>;
    scopeConversationId: string | null;
    scopePathHeadMessageId: string | null;
  }[];
}): string[] {
  return [...expandCausalStateReferences({
    states: input.states,
    rootIds: input.purgeMessageIds,
    includePayload: false,
  })];
}

export type SubjectStateRepair = {
  stateId: string;
  nextPayload: Record<string, unknown> | null;
  /** True when a thought dropped by a purged turn becomes active again. */
  revivedThought?: true;
};

/**
 * Repairs surviving states whose derived payload rests on purged messages:
 * recall reinforcement is removed from Memory/Feel, and a Thought dropped by
 * a purged assistant message is active again.
 */
export function planSubjectStateRepairs(input: {
  states: readonly {
    id: string;
    kind: string;
    payload: Record<string, unknown> | null;
  }[];
  purgeMessageIds: ReadonlySet<string>;
  purgeStateIds: ReadonlySet<string>;
  memoryLifecyclePolicy?: MemoryLifecyclePolicy;
  repairedAt?: string;
}): SubjectStateRepair[] {
  return input.states.flatMap((state): SubjectStateRepair[] => {
    if (input.purgeStateIds.has(state.id) || !state.payload) return [];

    if (state.kind === "thought") {
      const lifecycle = readThoughtLifecycle(state.payload);
      if (
        lifecycle?.status === "dropped"
        && lifecycle.reason === "subject"
        && lifecycle.droppedByMessageId !== null
        && input.purgeMessageIds.has(lifecycle.droppedByMessageId)
      ) {
        return [{
          stateId: state.id,
          nextPayload: writeThoughtActive(state.payload),
          revivedThought: true,
        }];
      }
      return [];
    }

    if (state.kind === "memory" || state.kind === "feel") {
      let repaired;
      try {
        repaired = removeRecallReinforcementSources(
          state.payload,
          input.purgeMessageIds,
          input.memoryLifecyclePolicy,
          input.repairedAt,
        );
      } catch {
        repaired = null;
      }
      if (repaired) {
        return [{
          stateId: state.id,
          nextPayload: repaired.nextPayload,
        }];
      }
    }
    return [];
  });
}

export function planExclusiveProviderSessionCleanup(input: {
  purgeMessageIds: ReadonlySet<string>;
  checkpoints: readonly {
    canonicalMessageId: string;
    provider: string;
    providerSessionId: string;
  }[];
}): string[] {
  const surviving = new Set(
    input.checkpoints
      .filter((checkpoint) =>
        !input.purgeMessageIds.has(checkpoint.canonicalMessageId)
      )
      .map((checkpoint) =>
        `${checkpoint.provider}:\0${checkpoint.providerSessionId}`
      ),
  );

  return [
    ...new Set(
      input.checkpoints
        .filter((checkpoint) =>
          input.purgeMessageIds.has(checkpoint.canonicalMessageId)
          && !surviving.has(
            `${checkpoint.provider}:\0${checkpoint.providerSessionId}`,
          )
        )
        .map((checkpoint) => checkpoint.providerSessionId),
    ),
  ];
}

export function workflowReferencesAnyId(
  payload: Record<string, unknown> | null,
  ids: ReadonlySet<string>,
): boolean {
  return Boolean(payload) && structuredValueReferencesAnyId(payload, ids);
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
