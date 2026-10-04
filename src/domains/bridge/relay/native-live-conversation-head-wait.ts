import { and, eq } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import { conversations } from "../../../database/schema.js";
import type {
  NativeLiveWorkWakeBroker,
} from "./native-live-work-wake.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type NativeLiveConversationHeadWaitResult =
  | {
      outcome: "changed";
      currentHeadMessageId: string | null;
    }
  | {
      outcome: "timeout";
      currentHeadMessageId: string | null;
    };

export class NativeLiveConversationHeadWaitService {
  constructor(
    private readonly db: Database,
    private readonly wakeBroker: Pick<
      NativeLiveWorkWakeBroker,
      "start" | "release" | "version" | "waitForChange"
    >,
  ) {}

  async wait(input: {
    userId: string;
    conversationId: string;
    afterHeadMessageId: string | null;
    timeoutMs: number;
    signal?: AbortSignal | null;
  }): Promise<NativeLiveConversationHeadWaitResult | null> {
    const readHead = async (): Promise<string | null | undefined> => {
      const [row] = await this.db
        .select({
          currentHeadMessageId: conversations.currentHeadMessageId,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.userId, input.userId),
            eq(conversations.id, input.conversationId),
            eq(conversations.origin, "native_live"),
            eq(conversations.lifecycleStatus, "active"),
          ),
        )
        .limit(1);
      return row
        ? row.currentHeadMessageId
        : undefined;
    };

    const immediate = await readHead();
    if (immediate === undefined) return null;
    if (immediate !== input.afterHeadMessageId) {
      return {
        outcome: "changed",
        currentHeadMessageId: immediate,
      };
    }

    await this.wakeBroker.start();
    try {
      const deadline = Date.now() + input.timeoutMs;
      while (!input.signal?.aborted) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          const current = await readHead();
          if (current === undefined) return null;
          return {
            outcome: "timeout",
            currentHeadMessageId: current,
          };
        }

        const version = this.wakeBroker.version(input.userId);
        const raced = await readHead();
        if (raced === undefined) return null;
        if (raced !== input.afterHeadMessageId) {
          return {
            outcome: "changed",
            currentHeadMessageId: raced,
          };
        }

        const wake = await this.wakeBroker.waitForChange({
          userId: input.userId,
          afterVersion: version,
          timeoutMs: remaining,
          signal: input.signal,
        });
        if (wake.outcome === "timeout") {
          const current = await readHead();
          if (current === undefined) return null;
          return current !== input.afterHeadMessageId
            ? {
                outcome: "changed",
                currentHeadMessageId: current,
              }
            : {
                outcome: "timeout",
                currentHeadMessageId: current,
              };
        }
        // A user-scoped wake may belong to another conversation or to a
        // quiet/stale turn. Re-read and keep waiting within this bounded call.
      }

      const current = await readHead();
      if (current === undefined) return null;
      return {
        outcome: "timeout",
        currentHeadMessageId: current,
      };
    } finally {
      await this.wakeBroker.release();
    }
  }
}
