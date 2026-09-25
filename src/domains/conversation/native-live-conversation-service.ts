import type {
  NativeLiveContentBlockInput,
  NativeLiveConversation,
  NativeLiveConversationSummary,
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
  NativeLiveProviderCheckpointInput,
} from "./native-live-conversation-types.js";
import type {
  NativeLiveConversationDeleteResult,
  NativeLiveConversationRepository,
} from "./native-live-conversation-repository.js";

export class NativeLiveConversationService {
  constructor(private readonly repository: NativeLiveConversationRepository) {}

  createConversation(input: {
    userId: string;
    title?: string | null;
  }): Promise<NativeLiveConversation> {
    return this.repository.createConversation(input);
  }

  listConversations(input: {
    userId: string;
    limit: number;
  }): Promise<NativeLiveConversationSummary[]> {
    if (!this.repository.listConversations) {
      throw new Error("Native live conversation listing is unavailable.");
    }
    return this.repository.listConversations(input);
  }

  getConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversation | null> {
    return this.repository.getConversation(input);
  }

  deleteConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversationDeleteResult> {
    return this.repository.deleteConversation(input);
  }

  async appendUserMessage(input: {
    userId: string;
    conversationId: string;
    parentMessageId: string | null;
    blocks: NativeLiveContentBlockInput[];
  }): Promise<NativeLiveMessage> {
    return this.repository.withTransaction(async (repository) => {
      const message = await repository.appendUserMessage({
        userId: input.userId,
        conversationId: input.conversationId,
        parentMessageId: input.parentMessageId,
      });

      const blocks = [];
      for (const [ordinal, block] of input.blocks.entries()) {
        blocks.push(
          await repository.appendContentBlock({
            userId: input.userId,
            conversationId: input.conversationId,
            messageId: message.id,
            ordinal,
            block,
          }),
        );
      }

      return { ...message, blocks };
    });
  }

  async completeAssistantTurn(input: {
    userId: string;
    conversationId: string;
    parentMessageId: string;
    blocks: NativeLiveContentBlockInput[];
    checkpoint: NativeLiveProviderCheckpointInput;
  }): Promise<{
    message: NativeLiveMessage;
    checkpoint: NativeLiveProviderCheckpoint;
  }> {
    return this.repository.withTransaction(async (repository) => {
      const message = await repository.appendAssistantMessage({
        userId: input.userId,
        conversationId: input.conversationId,
        parentMessageId: input.parentMessageId,
      });

      const blocks = [];
      for (const [ordinal, block] of input.blocks.entries()) {
        blocks.push(
          await repository.appendContentBlock({
            userId: input.userId,
            conversationId: input.conversationId,
            messageId: message.id,
            ordinal,
            block,
          }),
        );
      }

      const checkpoint = await repository.bindProviderCheckpoint({
        userId: input.userId,
        conversationId: input.conversationId,
        canonicalMessageId: message.id,
        checkpoint: input.checkpoint,
      });

      await repository.setCurrentHead({
        userId: input.userId,
        conversationId: input.conversationId,
        messageId: message.id,
      });

      return { message: { ...message, blocks }, checkpoint };
    });
  }

  setCurrentHead(input: {
    userId: string;
    conversationId: string;
    messageId: string;
  }): Promise<void> {
    return this.repository.setCurrentHead(input);
  }

  getProviderCheckpointForHead(input: {
    userId: string;
    conversationId: string;
    canonicalMessageId: string;
  }): Promise<NativeLiveProviderCheckpoint | null> {
    return this.repository.getProviderCheckpointForHead(input);
  }
}
