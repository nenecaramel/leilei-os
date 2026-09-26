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
  const initiallySelected = new Set(
    input.states
      .filter((state) =>
        input.resetDistillation
        && state.kind === "memory"
        && state.scopeConversationId === input.conversationId
        && state.payload?.formation === "distillation"
      )
      .map((state) => state.id),
  );

  return [...expandCausalStateReferences({
    states: input.states,
    rootIds: input.purgeMessageIds,
    initiallySelectedStateIds: initiallySelected,
    includePayload: false,
  })];
}

export type SubjectStateEvolutionRepair = {
  stateId: string;
  nextPayload: Record<string, unknown> | null;
};

export function planSubjectStateEvolutionRepairs(input: {
  states: readonly {
    id: string;
    kind: string;
    payload: Record<string, unknown> | null;
  }[];
  purgeMessageIds: ReadonlySet<string>;
  purgeStateIds: ReadonlySet<string>;
  additionalEvolutionCausalIds?: ReadonlySet<string>;
  memoryLifecyclePolicy?: MemoryLifecyclePolicy;
  repairedAt?: string;
}): SubjectStateEvolutionRepair[] {
  const causalIds = new Set<string>([
    ...input.purgeMessageIds,
    ...input.purgeStateIds,
    ...(input.additionalEvolutionCausalIds ?? []),
  ]);
  const evolutionKeyByKind: Record<string, string | undefined> = {
    drive: "drive_v1",
    thought: "thought_v1",
    topic: "topic_v1",
  };

  return input.states.flatMap((state) => {
    if (input.purgeStateIds.has(state.id) || !state.payload) return [];

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

    if (state.kind === "curiosity" && "curiosity_v1" in state.payload) {
      const evolution = state.payload.curiosity_v1;
      if (
        evolution
        && typeof evolution === "object"
        && !Array.isArray(evolution)
        && typeof (evolution as Record<string, unknown>).resolutionSourceId
          === "string"
        && input.purgeMessageIds.has(
          (evolution as Record<string, unknown>).resolutionSourceId as string,
        )
      ) {
        const nextPayload = { ...state.payload };
        delete nextPayload.curiosity_v1;
        return [{
          stateId: state.id,
          nextPayload:
            Object.keys(nextPayload).length > 0 ? nextPayload : null,
        }];
      }
    }

    const evolutionKey = evolutionKeyByKind[state.kind];
    if (!evolutionKey || !(evolutionKey in state.payload)) return [];
    const evolutionPayload = state.payload[evolutionKey];
    if (!structuredValueReferencesAnyId(evolutionPayload, causalIds)) {
      return [];
    }
    const nextPayload = { ...state.payload };
    delete nextPayload[evolutionKey];
    return [{
      stateId: state.id,
      nextPayload:
        Object.keys(nextPayload).length > 0 ? nextPayload : null,
    }];
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
