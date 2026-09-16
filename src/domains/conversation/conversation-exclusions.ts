import { hashCanonical } from "../import/import-canonical.js";
import type {
  ConversationProvider,
  NormalizedConversation,
} from "./conversation-types.js";

export type ConversationExclusionRule = {
  provider: ConversationProvider;
  scope: "conversation" | "branch";
  sourceConversationId: string;
  sourceNodeId: string | null;
};

export type ConversationExclusionSummary = {
  conversations: number;
  messages: number;
  branch_roots: number;
};

export type AppliedConversationExclusions = {
  conversation: NormalizedConversation | null;
  relevantRules: ConversationExclusionRule[];
  summary: ConversationExclusionSummary;
  fingerprint: string;
};

function sortedRules(
  rules: readonly ConversationExclusionRule[],
): ConversationExclusionRule[] {
  return [...rules].sort((left, right) => {
    const leftKey = `${left.provider}\u0000${left.sourceConversationId}\u0000${left.scope}\u0000${left.sourceNodeId ?? ""}`;
    const rightKey = `${right.provider}\u0000${right.sourceConversationId}\u0000${right.scope}\u0000${right.sourceNodeId ?? ""}`;
    return leftKey.localeCompare(rightKey);
  });
}

export function applyConversationExclusions(
  conversation: NormalizedConversation,
  rules: readonly ConversationExclusionRule[],
): AppliedConversationExclusions {
  const relevantRules = sortedRules(rules.filter((rule) =>
    rule.provider === conversation.provider
    && rule.sourceConversationId === conversation.sourceConversationId
  ));
  const fingerprint = hashCanonical(relevantRules);

  if (relevantRules.some((rule) => rule.scope === "conversation")) {
    return {
      conversation: null,
      relevantRules,
      summary: {
        conversations: 1,
        messages: conversation.messages.length,
        branch_roots: relevantRules.filter((rule) => rule.scope === "branch").length,
      },
      fingerprint,
    };
  }

  const branchRoots = new Set(
    relevantRules
      .filter((rule) => rule.scope === "branch" && rule.sourceNodeId)
      .map((rule) => rule.sourceNodeId as string),
  );
  if (branchRoots.size === 0) {
    return {
      conversation,
      relevantRules,
      summary: { conversations: 0, messages: 0, branch_roots: 0 },
      fingerprint,
    };
  }

  const children = new Map<string, string[]>();
  const present = new Set<string>();
  for (const message of conversation.messages) {
    present.add(message.sourceNodeId);
    if (!message.parentSourceNodeId) continue;
    const list = children.get(message.parentSourceNodeId) ?? [];
    list.push(message.sourceNodeId);
    children.set(message.parentSourceNodeId, list);
  }

  const excluded = new Set<string>();
  const matchedRoots: string[] = [];
  for (const root of branchRoots) {
    if (!present.has(root)) continue;
    matchedRoots.push(root);
    const queue = [root];
    while (queue.length > 0) {
      const node = queue.pop()!;
      if (excluded.has(node)) continue;
      excluded.add(node);
      for (const child of children.get(node) ?? []) queue.push(child);
    }
  }

  if (excluded.size === 0) {
    return {
      conversation,
      relevantRules,
      summary: { conversations: 0, messages: 0, branch_roots: 0 },
      fingerprint,
    };
  }

  const messages = conversation.messages.filter(
    (message) => !excluded.has(message.sourceNodeId),
  );
  const remainingCurrentPath = messages
    .filter(
      (message) => message.isCurrentPath && message.currentPathIndex !== null,
    )
    .sort(
      (left, right) =>
        (left.currentPathIndex ?? Number.MAX_SAFE_INTEGER)
        - (right.currentPathIndex ?? Number.MAX_SAFE_INTEGER),
    );
  const currentLeafSourceNodeId =
    conversation.currentLeafSourceNodeId
    && excluded.has(conversation.currentLeafSourceNodeId)
      ? remainingCurrentPath.at(-1)?.sourceNodeId ?? null
      : conversation.currentLeafSourceNodeId;

  return {
    conversation: {
      ...conversation,
      currentLeafSourceNodeId,
      messages,
    },
    relevantRules,
    summary: {
      conversations: 0,
      messages: excluded.size,
      branch_roots: matchedRoots.length,
    },
    fingerprint,
  };
}
