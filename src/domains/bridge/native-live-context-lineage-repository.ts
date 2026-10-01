import { and, eq } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { runtimeContextLineageStates } from "../../database/schema.js";
import {
  normalizeContextLineageState,
  type ContextLineageState,
} from "../runtime/context-lineage.js";

type Database = ReturnType<typeof createDatabase>["db"];

export interface NativeLiveContextLineageReader {
  readForMessage(input: {
    userId: string;
    conversationId: string;
    canonicalMessageId: string | null;
  }): Promise<ContextLineageState>;
}

export class DrizzleNativeLiveContextLineageReader
implements NativeLiveContextLineageReader {
  constructor(private readonly db: Database) {}

  async readForMessage(input: {
    userId: string;
    conversationId: string;
    canonicalMessageId: string | null;
  }): Promise<ContextLineageState> {
    if (!input.canonicalMessageId) {
      return normalizeContextLineageState(null);
    }

    const [row] = await this.db
      .select({
        epoch: runtimeContextLineageStates.epoch,
        seenStateIds: runtimeContextLineageStates.seenStateIds,
        thoughtRevision: runtimeContextLineageStates.thoughtRevision,
        thoughtFingerprint: runtimeContextLineageStates.thoughtFingerprint,
      })
      .from(runtimeContextLineageStates)
      .where(
        and(
          eq(runtimeContextLineageStates.userId, input.userId),
          eq(
            runtimeContextLineageStates.conversationId,
            input.conversationId,
          ),
          eq(
            runtimeContextLineageStates.canonicalMessageId,
            input.canonicalMessageId,
          ),
        ),
      )
      .limit(1);

    if (!row) {
      return normalizeContextLineageState({
        epoch: 0,
        seenStateIds: [],
        thoughtRevision: 0,
        thoughtFingerprint: null,
        forceThoughtSnapshot: true,
      });
    }

    return normalizeContextLineageState({
      epoch: row.epoch,
      seenStateIds: row.seenStateIds,
      thoughtRevision: row.thoughtRevision,
      thoughtFingerprint: row.thoughtFingerprint,
    });
  }
}
