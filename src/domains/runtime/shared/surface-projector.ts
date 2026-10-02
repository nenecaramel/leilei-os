import type {
  NativeLiveConversation,
  NativeLiveMessage,
} from "../../conversation/native-live-conversation-types.js";

export type SurfaceEntry = {
  messageId: string;
  parentMessageId: string | null;
  role: NativeLiveMessage["role"];
  text: string;
  createdAt: string;
  completedAt: string | null;
};

export class SurfaceProjectionError extends Error {
  constructor(
    readonly code:
      | "INVALID_LIMIT"
      | "HEAD_NOT_FOUND"
      | "PARENT_NOT_FOUND"
      | "MESSAGE_CYCLE",
    message: string,
  ) {
    super(message);
    this.name = "SurfaceProjectionError";
  }
}

function messageText(message: NativeLiveMessage): string {
  return message.blocks
    .filter((block) => block.kind === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function canonicalPathToHead(
  conversation: NativeLiveConversation,
  headMessageId: string | null = conversation.currentHeadMessageId,
): NativeLiveMessage[] {
  if (!headMessageId) return [];

  const byId = new Map(
    conversation.messages.map((message) => [message.id, message] as const),
  );
  const visited = new Set<string>();
  const reversed: NativeLiveMessage[] = [];
  let cursor: string | null = headMessageId;

  while (cursor) {
    if (visited.has(cursor)) {
      throw new SurfaceProjectionError(
        "MESSAGE_CYCLE",
        "Canonical message parent chain contains a cycle.",
      );
    }
    visited.add(cursor);

    const message = byId.get(cursor);
    if (!message) {
      throw new SurfaceProjectionError(
        reversed.length === 0 ? "HEAD_NOT_FOUND" : "PARENT_NOT_FOUND",
        `Canonical message ${cursor} is missing from the conversation snapshot.`,
      );
    }
    reversed.push(message);
    cursor = message.parentMessageId;
  }

  return reversed.reverse();
}

export function projectCanonicalSurface(
  conversation: NativeLiveConversation,
  input: {
    maxMessages: number;
    headMessageId?: string | null;
  },
): SurfaceEntry[] {
  if (!Number.isInteger(input.maxMessages) || input.maxMessages < 1) {
    throw new SurfaceProjectionError(
      "INVALID_LIMIT",
      "Surface maxMessages must be a positive integer.",
    );
  }

  const path = canonicalPathToHead(
    conversation,
    input.headMessageId === undefined
      ? conversation.currentHeadMessageId
      : input.headMessageId,
  );

  return path.slice(-input.maxMessages).map((message) => ({
    messageId: message.id,
    parentMessageId: message.parentMessageId,
    role: message.role,
    text: messageText(message),
    createdAt: message.createdAt,
    completedAt: message.completedAt,
  }));
}
