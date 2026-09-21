import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { conversations, users } from "../src/database/schema.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { NativeLiveConversationService } from "../src/domains/conversation/native-live-conversation-service.js";
import {
  NativeLiveConversationOrchestrator,
  type NativeLiveRuntimeResult,
} from "../src/domains/conversation/native-live-conversation-orchestrator.js";
import { HeadlessClaudeTransport } from "../tools/claude-bridge/src/headless-claude-transport.mjs";

const resultPath = "/tmp/leileios-native-live-canonical-e2e.json";

function finalText(result: {
  assistantMessage: { blocks: Array<{ kind: string; text: string | null }> };
}): string {
  return result.assistantMessage.blocks
    .filter((block) => block.kind === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();
}

void (async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required");
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined, "ANTHROPIC_API_KEY must be unset");

  const database = createDatabase(databaseUrl);
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const marker = `ROOT_${suffix}`;
  let userId: string | null = null;
  let conversationId: string | null = null;

  try {
    const [user] = await database.db
      .insert(users)
      .values({
        email: `native-live-e2e-${suffix}@example.com`,
        displayName: "Native Live Canonical E2E",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const repository = new DrizzleNativeLiveConversationRepository(database.db);
    const service = new NativeLiveConversationService(repository);
    const transport = new HeadlessClaudeTransport();

    const adapt = async (work: Promise<any>): Promise<NativeLiveRuntimeResult> => {
      const result = await work;
      return {
        providerSessionId: result.providerSessionId ?? null,
        normalizedEvents: result.normalizedEvents ?? [],
      };
    };

    const orchestrator = new NativeLiveConversationOrchestrator(service, {
      sendNew: (prompt) => adapt(transport.sendNew(prompt)),
      resume: (sessionId, prompt) => adapt(transport.resume(sessionId, prompt)),
      fork: (sessionId, prompt) => adapt(transport.fork(sessionId, prompt)),
    });

    const conversation = await service.createConversation({
      userId,
      title: "Native live canonical E2E",
    });
    conversationId = conversation.id;

    const first = await orchestrator.send({
      userId,
      conversationId,
      text: `Remember exactly ${marker}. Reply only READY.`,
    });
    assert.equal(first.ok, true, first.ok ? undefined : first.message);

    const second = await orchestrator.send({
      userId,
      conversationId,
      text: "Reply with only the exact ROOT marker I asked you to remember.",
    });
    assert.equal(second.ok, true, second.ok ? undefined : second.message);
    if (!first.ok || !second.ok) throw new Error("unreachable after assertions");

    assert.equal(finalText(second), marker);
    assert.notEqual(
      first.checkpoint.providerSessionId,
      second.checkpoint.providerSessionId,
      "ordinary progression must fork to a new provider session checkpoint",
    );

    const stored = await service.getConversation({ userId, conversationId });
    assert.ok(stored);
    assert.equal(stored.messages.length, 4);
    assert.equal(stored.currentHeadMessageId, second.assistantMessage.id);

    const result = {
      status: "accepted",
      conversationId,
      marker,
      firstAssistantMessageId: first.assistantMessage.id,
      secondAssistantMessageId: second.assistantMessage.id,
      firstProviderSessionId: first.checkpoint.providerSessionId,
      secondProviderSessionId: second.checkpoint.providerSessionId,
      currentHeadMessageId: stored.currentHeadMessageId,
      secondFinalText: finalText(second),
    };
    await writeFile(resultPath, JSON.stringify(result, null, 2) + "\n");
    console.log("[E2E] COMPLETE", JSON.stringify(result));
  } catch (error) {
    const failure = {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
    await writeFile(resultPath, JSON.stringify(failure, null, 2) + "\n");
    console.error("[E2E] FAILED", failure);
    process.exitCode = 1;
  } finally {
    if (conversationId && userId) {
      await database.db
        .delete(conversations)
        .where(eq(conversations.id, conversationId));
    }
    if (userId) {
      await database.db.delete(users).where(eq(users.id, userId));
    }
    await database.close();
  }
})();
