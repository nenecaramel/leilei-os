import { and, asc, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { todoEntries, todoPapers } from "../../database/schema.js";
import {
  lockAndReadMcpIdempotency,
  recordMcpIdempotency,
  type McpIdempotencyTransaction,
} from "../mcp-write/mcp-write-idempotency.js";
import type {
  ReplaceTodoPaperInput,
  ReplaceTodoPaperIdempotentlyInput,
  ReplaceTodoPaperIdempotentlyResult,
  ReplaceTodoPaperResult,
  TodoDayPapers,
  TodoEntry,
  TodoPaper,
  TodoRepository,
} from "./todo-types.js";

type Database = ReturnType<typeof createDatabase>["db"];
type QueryDatabase = Database & { execute: (query: unknown) => Promise<unknown> };
type CommittedPaperWithId =
  | { outcome: "committed"; paper: TodoPaper; paperId: string }
  | { outcome: "conflict" };

function toPaper(
  row: { author: "L" | "G"; businessDate: string; revision: number },
  entries: TodoEntry[],
): TodoPaper {
  return {
    author: row.author,
    date: row.businessDate,
    revision: row.revision,
    entries,
  };
}

export class DrizzleTodoRepository implements TodoRepository {
  constructor(private readonly db: Database) {}

  private async readPaper(
    database: Database,
    userId: string,
    date: string,
    author: "L" | "G",
  ): Promise<TodoPaper | null> {
    const [paper] = await database
      .select({
        author: todoPapers.author,
        businessDate: todoPapers.businessDate,
        revision: todoPapers.revision,
        id: todoPapers.id,
      })
      .from(todoPapers)
      .where(
        and(
          eq(todoPapers.userId, userId),
          eq(todoPapers.businessDate, date),
          eq(todoPapers.author, author),
        ),
      )
      .limit(1);
    if (!paper) return null;
    const entries = await database
      .select({ id: todoEntries.entryId, kind: todoEntries.kind, text: todoEntries.text })
      .from(todoEntries)
      .where(eq(todoEntries.paperId, paper.id))
      .orderBy(asc(todoEntries.position));
    return toPaper(paper, entries);
  }

  private async readPaperById(
    database: Database,
    userId: string,
    paperId: string,
  ): Promise<TodoPaper | null> {
    const [paper] = await database
      .select({
        author: todoPapers.author,
        businessDate: todoPapers.businessDate,
        revision: todoPapers.revision,
        id: todoPapers.id,
      })
      .from(todoPapers)
      .where(and(eq(todoPapers.userId, userId), eq(todoPapers.id, paperId)))
      .limit(1);
    if (!paper) return null;
    const entries = await database
      .select({ id: todoEntries.entryId, kind: todoEntries.kind, text: todoEntries.text })
      .from(todoEntries)
      .where(eq(todoEntries.paperId, paper.id))
      .orderBy(asc(todoEntries.position));
    return toPaper(paper, entries);
  }

  async readDay(userId: string, date: string): Promise<TodoDayPapers> {
    const [L, G] = await Promise.all([
      this.readPaper(this.db, userId, date, "L"),
      this.readPaper(this.db, userId, date, "G"),
    ]);
    return { L, G };
  }

  async listContentDates(userId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ date: todoPapers.businessDate })
      .from(todoPapers)
      .innerJoin(todoEntries, eq(todoEntries.paperId, todoPapers.id))
      .where(eq(todoPapers.userId, userId))
      .orderBy(asc(todoPapers.businessDate));
    return rows.map((row) => row.date);
  }

  async replacePaper(input: ReplaceTodoPaperInput): Promise<ReplaceTodoPaperResult> {
    return this.db.transaction(async (transaction) => {
      const result = await this.replacePaperWithinTransaction(
        transaction as McpIdempotencyTransaction,
        input,
      );
      return result.outcome === "conflict"
        ? result
        : { outcome: "committed", paper: result.paper };
    });
  }

  async replacePaperIdempotently(
    input: ReplaceTodoPaperIdempotentlyInput,
  ): Promise<ReplaceTodoPaperIdempotentlyResult> {
    return this.db.transaction(async (transaction) => {
      const idempotency = await lockAndReadMcpIdempotency(transaction, {
        userId: input.userId,
        toolName: "write_todo_paper",
        idempotencyKey: input.idempotencyKey,
      });
      if (idempotency) {
        if (
          idempotency.requestHash !== input.requestHash ||
          idempotency.resourceType !== "todo_paper"
        ) {
          return { outcome: "idempotency_conflict" };
        }
        await (transaction as unknown as QueryDatabase).execute(
          sql`select id from ${todoPapers} where id = ${idempotency.resourceId} and user_id = ${input.userId} for update`,
        );
        const paper = await this.readPaperById(
          transaction as unknown as Database,
          input.userId,
          idempotency.resourceId,
        );
        if (!paper) throw new Error("Idempotent Todo paper was not found.");
        return { outcome: "replayed", paper };
      }

      const replaced = await this.replacePaperWithinTransaction(
        transaction,
        input,
      );
      if (replaced.outcome === "conflict") {
        return { outcome: "revision_conflict" };
      }
      await recordMcpIdempotency(transaction, {
        userId: input.userId,
        toolName: "write_todo_paper",
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        resourceType: "todo_paper",
        resourceId: replaced.paperId,
      });
      return { outcome: "committed", paper: replaced.paper };
    });
  }

  private async replacePaperWithinTransaction(
    transaction: McpIdempotencyTransaction,
    input: ReplaceTodoPaperInput,
  ): Promise<CommittedPaperWithId> {
    const database = transaction as unknown as Database;
    const tx = transaction as unknown as QueryDatabase;
    let current = await this.readPaper(
      database,
      input.userId,
      input.date,
      input.author,
    );
    if (current) {
      await tx.execute(
        sql`select id from ${todoPapers} where user_id = ${input.userId} and business_date = ${input.date} and author = ${input.author} for update`,
      );
      current = await this.readPaper(
        database,
        input.userId,
        input.date,
        input.author,
      );
      if (
        !current ||
        input.expectedRevision === null ||
        current.revision !== input.expectedRevision
      ) {
        return { outcome: "conflict" };
      }
    } else if (input.expectedRevision !== null) {
      return { outcome: "conflict" };
    }

    let paperId: string;
    let revision: number;
    if (!current) {
      const [inserted] = await transaction
        .insert(todoPapers)
        .values({
          userId: input.userId,
          businessDate: input.date,
          author: input.author,
          revision: 1,
        })
        .onConflictDoNothing({
          target: [todoPapers.userId, todoPapers.businessDate, todoPapers.author],
        })
        .returning({ id: todoPapers.id });
      if (!inserted) return { outcome: "conflict" };
      paperId = inserted.id;
      revision = 1;
    } else {
      const [row] = await transaction
        .select({ id: todoPapers.id, revision: todoPapers.revision })
        .from(todoPapers)
        .where(and(
          eq(todoPapers.userId, input.userId),
          eq(todoPapers.businessDate, input.date),
          eq(todoPapers.author, input.author),
        ))
        .limit(1);
      if (!row) return { outcome: "conflict" };
      paperId = row.id;
      revision = row.revision + 1;
      await transaction
        .update(todoPapers)
        .set({ revision, updatedAt: new Date() })
        .where(eq(todoPapers.id, paperId));
      await transaction.delete(todoEntries).where(eq(todoEntries.paperId, paperId));
    }
    if (input.entries.length > 0) {
      await transaction.insert(todoEntries).values(
        input.entries.map((entry, position) => ({
          paperId,
          entryId: entry.id,
          kind: entry.kind,
          text: entry.text,
          position,
        })),
      );
    }
    return {
      outcome: "committed",
      paperId,
      paper: {
        author: input.author,
        date: input.date,
        revision,
        entries: input.entries.map((entry) => ({ ...entry })),
      },
    };
  }
}
