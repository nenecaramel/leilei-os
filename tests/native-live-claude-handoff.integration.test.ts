import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import {
  and,
  eq,
} from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  nativeLiveClaudeHandoffs,
  nativeLiveRuntimeListenerLeases,
  users,
} from "../src/database/schema.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import {
  NativeLiveConversationService,
} from "../src/domains/conversation/native-live-conversation-service.js";
import {
  DrizzleNativeLiveCurrentPathReader,
} from "../src/domains/conversation/native-live-current-path-read-repository.js";
import {
  NativeLiveClaudeHandoffService,
} from "../src/domains/bridge/provider-session/native-live-claude-handoff.js";

const enabled =
  process.env.RUN_NATIVE_LIVE_CONVERSATION_DATABASE_TEST
    === "1";

test(
  "Claude handoff archives only the exact source head, remains readable, and accepts a late durable receipt",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const database = createDatabase(databaseUrl, {
      ssl: false,
      createClient: (
        url,
        maxConnections,
        ssl,
      ) =>
        postgres(url, {
          max: maxConnections,
          prepare: false,
          ssl,
          connect_timeout: 15,
          idle_timeout: 60,
        }),
    });

    const [user] = await database.db
      .insert(users)
      .values({
        email:
          `native-live-handoff-${crypto.randomUUID()}@example.com`,
        displayName: "Native Live Handoff",
      })
      .returning({ id: users.id });
    assert.ok(user);

    const userId = user.id;
    const listenerInstanceId = crypto.randomUUID();

    t.after(async () => {
      try {
        await database.db
          .delete(conversations)
          .where(
            eq(conversations.userId, userId),
          );
        await database.db
          .delete(nativeLiveRuntimeListenerLeases)
          .where(
            eq(
              nativeLiveRuntimeListenerLeases.userId,
              userId,
            ),
          );
        await database.db
          .delete(users)
          .where(eq(users.id, userId));
      } finally {
        await database.close();
      }
    });

    await database.db
      .insert(nativeLiveRuntimeListenerLeases)
      .values({
        userId,
        dispatchTarget: "claude_code",
        listenerInstanceId,
        leaseExpiresAt:
          new Date(Date.now() + 10 * 60_000),
      });

    const repository =
      new DrizzleNativeLiveConversationRepository(
        database.db,
      );
    const conversationsService =
      new NativeLiveConversationService(repository);
    const currentPath =
      new DrizzleNativeLiveCurrentPathReader(
        database.db,
      );
    const handoffs =
      new NativeLiveClaudeHandoffService(
        database.db,
        {
          async notify() {},
        },
        {
          async isListenerOnline() {
            return true;
          },
        },
      );

    async function seededConversation(
      title: string,
      sessionId: string,
    ) {
      const conversation =
        await conversationsService
          .createConversation({
            userId,
            title,
          });
      const userMessage =
        await conversationsService
          .appendUserMessage({
            userId,
            conversationId:
              conversation.id,
            parentMessageId: null,
            blocks: [{
              kind: "text",
              text: "hello",
            }],
          });
      const assistant =
        await conversationsService
          .completeAssistantTurn({
            userId,
            conversationId:
              conversation.id,
            parentMessageId:
              userMessage.id,
            blocks: [{
              kind: "text",
              text: "hello back",
            }],
            checkpoint: {
              provider: "claude_code",
              providerSessionId:
                sessionId,
              providerCheckpointId:
                crypto.randomUUID(),
              effectiveWorkingDirectory:
                "/tmp/leileios-handoff-test",
            },
          });
      return {
        conversation,
        userMessage,
        assistant,
      };
    }

    const exact =
      await seededConversation(
        "Exact handoff",
        crypto.randomUUID(),
      );
    const exactRequest =
      await handoffs.create({
        userId,
        conversationId:
          exact.conversation.id,
      });
    const exactReplay =
      await handoffs.create({
        userId,
        conversationId:
          exact.conversation.id,
      });
    assert.equal(
      exactReplay.id,
      exactRequest.id,
    );

    const exactReservation =
      await handoffs.reserveNext({
        userId,
        listenerInstanceId,
      });
    assert.ok(exactReservation);
    assert.equal(
      exactReservation.sourceMessageId,
      exact.assistant.message.id,
    );
    assert.equal(
      exactReservation.expectedHeadMessageId,
      exact.assistant.message.id,
    );

    const exactB = crypto.randomUUID();
    assert.equal(
      await handoffs.complete({
        userId,
        listenerInstanceId,
        reservationId:
          exactReservation.reservationId,
        outcome: {
          status: "success",
          handoffSessionId: exactB,
        },
      }),
      "completed",
    );

    assert.equal(
      (
        await conversationsService
          .getConversation({
            userId,
            conversationId:
              exact.conversation.id,
          })
      )?.lifecycleStatus,
      "archived",
    );
    assert.equal(
      (
        await handoffs.read({
          userId,
          requestId: exactRequest.id,
        })
      )?.handoffSessionId,
      exactB,
    );
    assert.equal(
      (
        await conversationsService
          .restoreConversation({
            userId,
            conversationId:
              exact.conversation.id,
          })
      ).outcome,
      "handoff_archived",
    );
    const archivedPath =
      await currentPath.readCurrentPath({
        userId,
        conversationId:
          exact.conversation.id,
        limit: 20,
      });
    assert.ok(archivedPath);
    assert.equal(
      archivedPath.currentHeadMessageId,
      exact.assistant.message.id,
    );

    const stale =
      await seededConversation(
        "Stale handoff",
        crypto.randomUUID(),
      );
    const staleRequest =
      await handoffs.create({
        userId,
        conversationId:
          stale.conversation.id,
      });
    const staleReservation =
      await handoffs.reserveNext({
        userId,
        listenerInstanceId,
      });
    assert.ok(staleReservation);

    const laterUser =
      await conversationsService
        .appendUserMessage({
          userId,
          conversationId:
            stale.conversation.id,
          parentMessageId:
            stale.assistant.message.id,
          blocks: [{
            kind: "text",
            text: "later",
          }],
        });
    const laterAssistant =
      await conversationsService
        .completeAssistantTurn({
          userId,
          conversationId:
            stale.conversation.id,
          parentMessageId:
            laterUser.id,
          blocks: [{
            kind: "text",
            text: "later back",
          }],
          checkpoint: {
            provider: "claude_code",
            providerSessionId:
              staleReservation.providerSessionId,
            providerCheckpointId:
              crypto.randomUUID(),
            effectiveWorkingDirectory:
              "/tmp/leileios-handoff-test",
          },
        });

    const staleB = crypto.randomUUID();
    assert.equal(
      await handoffs.complete({
        userId,
        listenerInstanceId,
        reservationId:
          staleReservation.reservationId,
        outcome: {
          status: "success",
          handoffSessionId: staleB,
        },
      }),
      "stale",
    );
    assert.equal(
      (
        await conversationsService
          .getConversation({
            userId,
            conversationId:
              stale.conversation.id,
          })
      )?.lifecycleStatus,
      "active",
    );
    assert.equal(
      (
        await handoffs.read({
          userId,
          requestId:
            staleRequest.id,
        })
      )?.status,
      "stale",
    );
    assert.equal(
      (
        await currentPath.readCurrentPath({
          userId,
          conversationId:
            stale.conversation.id,
          limit: 20,
        })
      )?.currentHeadMessageId,
      laterAssistant.message.id,
    );

    const late =
      await seededConversation(
        "Late receipt",
        crypto.randomUUID(),
      );
    const lateRequest =
      await handoffs.create({
        userId,
        conversationId:
          late.conversation.id,
      });
    const lateReservation =
      await handoffs.reserveNext({
        userId,
        listenerInstanceId,
      });
    assert.ok(lateReservation);

    await database.db
      .update(nativeLiveClaudeHandoffs)
      .set({
        reservationExpiresAt:
          new Date(Date.now() - 1_000),
      })
      .where(
        and(
          eq(
            nativeLiveClaudeHandoffs.id,
            lateReservation.reservationId,
          ),
          eq(
            nativeLiveClaudeHandoffs.userId,
            userId,
          ),
        ),
      );

    assert.equal(
      (
        await handoffs.read({
          userId,
          requestId: lateRequest.id,
        })
      )?.status,
      "delivery_unknown",
    );

    const lateB = crypto.randomUUID();
    assert.equal(
      await handoffs.complete({
        userId,
        listenerInstanceId,
        reservationId:
          lateReservation.reservationId,
        outcome: {
          status: "success",
          handoffSessionId: lateB,
        },
      }),
      "completed",
    );
    assert.equal(
      (
        await conversationsService
          .getConversation({
            userId,
            conversationId:
              late.conversation.id,
          })
      )?.lifecycleStatus,
      "archived",
    );
    assert.equal(
      (
        await handoffs.read({
          userId,
          requestId: lateRequest.id,
        })
      )?.status,
      "completed",
    );

    const lateFailure =
      await seededConversation(
        "Late failure receipt",
        crypto.randomUUID(),
      );
    const lateFailureRequest =
      await handoffs.create({
        userId,
        conversationId:
          lateFailure.conversation.id,
      });
    const lateFailureReservation =
      await handoffs.reserveNext({
        userId,
        listenerInstanceId,
      });
    assert.ok(lateFailureReservation);

    await database.db
      .update(nativeLiveClaudeHandoffs)
      .set({
        reservationExpiresAt:
          new Date(Date.now() - 1_000),
      })
      .where(
        and(
          eq(
            nativeLiveClaudeHandoffs.id,
            lateFailureReservation.reservationId,
          ),
          eq(
            nativeLiveClaudeHandoffs.userId,
            userId,
          ),
        ),
      );

    assert.equal(
      (
        await handoffs.read({
          userId,
          requestId:
            lateFailureRequest.id,
        })
      )?.status,
      "delivery_unknown",
    );

    assert.equal(
      await handoffs.complete({
        userId,
        listenerInstanceId,
        reservationId:
          lateFailureReservation.reservationId,
        outcome: {
          status: "failure",
          failureCode:
            "NO_PROVIDER_SESSION",
        },
      }),
      "failed",
    );
    assert.equal(
      (
        await conversationsService
          .getConversation({
            userId,
            conversationId:
              lateFailure.conversation.id,
          })
      )?.lifecycleStatus,
      "active",
    );
    assert.equal(
      (
        await handoffs.read({
          userId,
          requestId:
            lateFailureRequest.id,
        })
      )?.status,
      "failed",
    );
  },
);
