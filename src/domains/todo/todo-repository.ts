import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { todoEntries, todoPapers, users } from "../../database/schema.js";
import {
  lockAndReadMcpIdempotency,
  recordMcpIdempotency,
  type McpIdempotencyTransaction,
} from "../mcp-write/mcp-write-idempotency.js";
import { requireActiveUserInTransaction } from "../require-active-user-transaction.js";
import { MAX_TODO_ENTRIES } from "../resource-limits.js";
import { CONTENT_AUTHORS, isContentAuthor, type ContentAuthor } from "../content-author.js";
import type {
  AppendTodoEntryIdempotentlyInput,
  DeleteTodoEntryIdempotentlyInput,
  ReplaceTodoPaperInput,
  ReplaceTodoPaperIdempotentlyInput,
  ReplaceTodoPaperIdempotentlyResult,
  ReplaceTodoPaperResult,
  TodoDayPapers,
  TodoEntry,
  TodoPaper,
  TodoSearchInput,
  TodoSearchRow,
  TodoRepository,
  UpdateTodoEntryIdempotentlyInput,
} from "./todo-types.js";

type Database = ReturnType<typeof createDatabase>["db"];
type QueryDatabase = Database & { execute: (query: unknown) => Promise<unknown> };
type CommittedPaperWithId =
  | { outcome: "committed"; paper: TodoPaper; paperId: string }
  | { outcome: "conflict" };

function toPaper(
  row: { author: unknown; businessDate: string; revision: number },
  entries: TodoEntry[],
): TodoPaper {
  if (!isContentAuthor(row.author)) {
    throw new Error("Todo paper has an invalid author.");
  }
  return {
    author: row.author,
    date: row.businessDate,
    revision: row.revision,
    entries,
  };
}

export class DrizzleTodoRepository implements TodoRepository {
  constructor(private readonly db: Database) {}

  async findUserById(userId: string): Promise<{ status: "active" | "disabled" } | null> {
    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user ?? null;
  }

  private async readPaper(
    database: Database,
    userId: string,
    date: string,
    author: ContentAuthor,
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
      .select({ id: todoEntries.entryId, kind: todoEntries.kind, text: todoEntries.text, revision: todoEntries.revision })
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
      .select({ id: todoEntries.entryId, kind: todoEntries.kind, text: todoEntries.text, revision: todoEntries.revision })
      .from(todoEntries)
      .where(eq(todoEntries.paperId, paper.id))
      .orderBy(asc(todoEntries.position));
    return toPaper(paper, entries);
  }

  async readDay(userId: string, date: string): Promise<TodoDayPapers> {
    const papers: TodoDayPapers = { L: null, G: null, C: null };
    await Promise.all(CONTENT_AUTHORS.map(async (author) => {
      const paper = await this.readPaper(this.db, userId, date, author);
      if (!paper) return;
      if (!isContentAuthor(paper.author)) {
        throw new Error("Todo paper has an invalid author.");
      }
      papers[paper.author] = paper;
    }));
    return papers;
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

  async searchEntries(input: TodoSearchInput): Promise<TodoSearchRow[]> {
    const pattern = `%${escapeLike(input.query)}%`;
    const conditions = [
      eq(todoPapers.userId, input.userId),
      sql`regexp_replace(lower(normalize(${todoEntries.text}, NFC)), '\\s+', ' ', 'g') like ${pattern} escape '\\'`,
    ];
    if (input.author) conditions.push(eq(todoPapers.author, input.author));
    if (input.kind) conditions.push(eq(todoEntries.kind, input.kind));
    if (input.dateFrom) conditions.push(sql`${todoPapers.businessDate} >= ${input.dateFrom}::date`);
    if (input.dateTo) conditions.push(sql`${todoPapers.businessDate} <= ${input.dateTo}::date`);
    const rows = await this.db
      .select({
        id: todoEntries.id,
        entryId: todoEntries.entryId,
        date: todoPapers.businessDate,
        author: todoPapers.author,
        kind: todoEntries.kind,
        text: todoEntries.text,
      })
      .from(todoEntries)
      .innerJoin(todoPapers, eq(todoEntries.paperId, todoPapers.id))
      .where(and(...conditions))
      .orderBy(desc(todoPapers.businessDate), desc(todoPapers.updatedAt), asc(todoEntries.position), asc(todoEntries.id))
      .limit(input.limit);
    return rows as TodoSearchRow[];
  }

  async replacePaper(input: ReplaceTodoPaperInput): Promise<ReplaceTodoPaperResult> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
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
      await requireActiveUserInTransaction(transaction, input.userId);
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

  async appendEntryIdempotently(input: AppendTodoEntryIdempotentlyInput) {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const idempotency = await lockAndReadMcpIdempotency(transaction, {
        userId: input.userId,
        toolName: "append_todo_entry",
        idempotencyKey: input.idempotencyKey,
      });
      if (idempotency) {
        if (idempotency.requestHash !== input.requestHash || idempotency.resourceType !== "todo_entry") {
          return { outcome: "idempotency_conflict" as const };
        }
        const paper = await this.lockPaperByIdentity(
          transaction as unknown as Database,
          input.userId,
          input.date,
          input.author,
        );
        if (!paper) return { outcome: "entry_not_found" as const };
        const entry = await this.readEntryByExternalId(
          transaction as unknown as Database,
          paper.id,
          idempotency.resourceId,
        );
        return entry
          ? { outcome: "replayed" as const, entry, paperRevision: paper.revision }
          : { outcome: "entry_not_found" as const };
      }

      let paper = await this.lockPaperByIdentity(
        transaction as unknown as Database,
        input.userId,
        input.date,
        input.author,
      );
      let createdPaper = false;
      if (!paper) {
        await transaction
          .insert(todoPapers)
          .values({
            userId: input.userId,
            businessDate: input.date,
            author: input.author,
            revision: 1,
          })
          .onConflictDoNothing({
            target: [todoPapers.userId, todoPapers.businessDate, todoPapers.author],
          });
        paper = await this.lockPaperByIdentity(
          transaction as unknown as Database,
          input.userId,
          input.date,
          input.author,
        );
        if (!paper) throw new Error("Todo paper creation failed.");
        createdPaper = paper.revision === 1 && (await this.countEntries(transaction as unknown as Database, paper.id)) === 0;
      }

      const stats = await this.entryStats(transaction as unknown as Database, paper.id);
      if (stats.count >= MAX_TODO_ENTRIES) return { outcome: "entry_limit" as const };

      const entryId = randomUUID();
      const [inserted] = await transaction
        .insert(todoEntries)
        .values({
          paperId: paper.id,
          entryId,
          kind: input.kind,
          text: input.text,
          revision: 1,
          position: (stats.maxPosition ?? -1) + 1,
        })
        .returning({
          id: todoEntries.entryId,
          kind: todoEntries.kind,
          text: todoEntries.text,
          revision: todoEntries.revision,
        });
      if (!inserted) throw new Error("Todo entry append failed.");

      let paperRevision = paper.revision;
      if (!createdPaper) {
        paperRevision = paper.revision + 1;
        await transaction
          .update(todoPapers)
          .set({ revision: paperRevision, updatedAt: new Date() })
          .where(eq(todoPapers.id, paper.id));
      }

      await recordMcpIdempotency(transaction, {
        userId: input.userId,
        toolName: "append_todo_entry",
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        resourceType: "todo_entry",
        resourceId: inserted.id,
      });
      return { outcome: "committed" as const, entry: inserted, paperRevision };
    });
  }

  async updateEntryIdempotently(input: UpdateTodoEntryIdempotentlyInput) {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const idempotency = await lockAndReadMcpIdempotency(transaction, {
        userId: input.userId,
        toolName: "update_todo_entry",
        idempotencyKey: input.idempotencyKey,
      });
      if (idempotency) {
        if (idempotency.requestHash !== input.requestHash || idempotency.resourceType !== "todo_entry") {
          return { outcome: "idempotency_conflict" as const };
        }
        const paper = await this.lockPaperByIdentity(
          transaction as unknown as Database,
          input.userId,
          input.date,
          input.author,
        );
        if (!paper) return { outcome: "entry_not_found" as const };
        const entry = await this.readEntryByExternalId(
          transaction as unknown as Database,
          paper.id,
          idempotency.resourceId,
        );
        return entry
          ? { outcome: "replayed" as const, entry, paperRevision: paper.revision }
          : { outcome: "entry_not_found" as const };
      }

      const paper = await this.lockPaperByIdentity(
        transaction as unknown as Database,
        input.userId,
        input.date,
        input.author,
      );
      if (!paper) return { outcome: "entry_not_found" as const };
      const [entry] = await transaction
        .select({
          internalId: todoEntries.id,
          id: todoEntries.entryId,
          kind: todoEntries.kind,
          text: todoEntries.text,
          revision: todoEntries.revision,
        })
        .from(todoEntries)
        .where(and(eq(todoEntries.paperId, paper.id), eq(todoEntries.entryId, input.entryId)))
        .for("update")
        .limit(1);
      if (!entry) return { outcome: "entry_not_found" as const };
      if (entry.revision !== input.expectedRevision) return { outcome: "entry_revision_conflict" as const };

      const nextKind = input.kind ?? entry.kind;
      const nextText = input.text ?? entry.text;
      let nextEntry = { id: entry.id, kind: entry.kind, text: entry.text, revision: entry.revision };
      let paperRevision = paper.revision;

      if (nextKind !== entry.kind || nextText !== entry.text) {
        const [updated] = await transaction
          .update(todoEntries)
          .set({ kind: nextKind, text: nextText, revision: entry.revision + 1 })
          .where(eq(todoEntries.id, entry.internalId))
          .returning({
            id: todoEntries.entryId,
            kind: todoEntries.kind,
            text: todoEntries.text,
            revision: todoEntries.revision,
          });
        if (!updated) throw new Error("Todo entry update failed.");
        nextEntry = updated;
        paperRevision = paper.revision + 1;
        await transaction
          .update(todoPapers)
          .set({ revision: paperRevision, updatedAt: new Date() })
          .where(eq(todoPapers.id, paper.id));
      }

      await recordMcpIdempotency(transaction, {
        userId: input.userId,
        toolName: "update_todo_entry",
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        resourceType: "todo_entry",
        resourceId: entry.id,
      });
      return { outcome: "committed" as const, entry: nextEntry, paperRevision };
    });
  }

  async deleteEntryIdempotently(input: DeleteTodoEntryIdempotentlyInput) {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const idempotency = await lockAndReadMcpIdempotency(transaction, {
        userId: input.userId,
        toolName: "delete_todo_entry",
        idempotencyKey: input.idempotencyKey,
      });
      if (idempotency) {
        if (idempotency.requestHash !== input.requestHash || idempotency.resourceType !== "todo_entry") {
          return { outcome: "idempotency_conflict" as const };
        }
        const paper = await this.lockPaperByIdentity(
          transaction as unknown as Database,
          input.userId,
          input.date,
          input.author,
        );
        if (!paper) return { outcome: "entry_not_found" as const };
        return { outcome: "replayed" as const, entryId: idempotency.resourceId, paperRevision: paper.revision };
      }

      const paper = await this.lockPaperByIdentity(
        transaction as unknown as Database,
        input.userId,
        input.date,
        input.author,
      );
      if (!paper) return { outcome: "entry_not_found" as const };
      const [entry] = await transaction
        .select({
          internalId: todoEntries.id,
          id: todoEntries.entryId,
          revision: todoEntries.revision,
        })
        .from(todoEntries)
        .where(and(eq(todoEntries.paperId, paper.id), eq(todoEntries.entryId, input.entryId)))
        .for("update")
        .limit(1);
      if (!entry) return { outcome: "entry_not_found" as const };
      if (entry.revision !== input.expectedRevision) return { outcome: "entry_revision_conflict" as const };

      await transaction.delete(todoEntries).where(eq(todoEntries.id, entry.internalId));
      const paperRevision = paper.revision + 1;
      await transaction
        .update(todoPapers)
        .set({ revision: paperRevision, updatedAt: new Date() })
        .where(eq(todoPapers.id, paper.id));

      await recordMcpIdempotency(transaction, {
        userId: input.userId,
        toolName: "delete_todo_entry",
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        resourceType: "todo_entry",
        resourceId: entry.id,
      });
      return { outcome: "committed" as const, entryId: entry.id, paperRevision };
    });
  }

  private async lockPaperByIdentity(
    database: Database,
    userId: string,
    date: string,
    author: ContentAuthor,
  ): Promise<{ id: string; revision: number } | null> {
    const [paper] = await database
      .select({ id: todoPapers.id, revision: todoPapers.revision })
      .from(todoPapers)
      .where(and(
        eq(todoPapers.userId, userId),
        eq(todoPapers.businessDate, date),
        eq(todoPapers.author, author),
      ))
      .for("update")
      .limit(1);
    return paper ?? null;
  }

  private async readEntryByExternalId(
    database: Database,
    paperId: string,
    entryId: string,
  ): Promise<TodoEntry | null> {
    const [entry] = await database
      .select({
        id: todoEntries.entryId,
        kind: todoEntries.kind,
        text: todoEntries.text,
        revision: todoEntries.revision,
      })
      .from(todoEntries)
      .where(and(eq(todoEntries.paperId, paperId), eq(todoEntries.entryId, entryId)))
      .limit(1);
    return entry ?? null;
  }

  private async countEntries(database: Database, paperId: string): Promise<number> {
    const [row] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(todoEntries)
      .where(eq(todoEntries.paperId, paperId));
    return row?.count ?? 0;
  }

  private async entryStats(database: Database, paperId: string): Promise<{ count: number; maxPosition: number | null }> {
    const [row] = await database
      .select({
        count: sql<number>`count(*)::int`,
        maxPosition: sql<number | null>`max(${todoEntries.position})`,
      })
      .from(todoEntries)
      .where(eq(todoEntries.paperId, paperId));
    return { count: row?.count ?? 0, maxPosition: row?.maxPosition ?? null };
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
    const previousById = new Map(
      (current?.entries ?? []).map((entry) => [entry.id, entry] as const),
    );
    const nextEntries = input.entries.map((entry) => {
      const previous = previousById.get(entry.id);
      const previousRevision = previous?.revision ?? 1;
      const entryRevision = !previous
        ? 1
        : previous.kind === entry.kind && previous.text === entry.text
          ? previousRevision
          : previousRevision + 1;
      return { ...entry, revision: entryRevision };
    });
    if (nextEntries.length > 0) {
      await transaction.insert(todoEntries).values(
        nextEntries.map((entry, position) => ({
          paperId,
          entryId: entry.id,
          kind: entry.kind,
          text: entry.text,
          revision: entry.revision,
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
        entries: nextEntries,
      },
    };
  }
}

function escapeLike(value: string): string { return value.replace(/[\\%_]/gu, "\\$&"); }
