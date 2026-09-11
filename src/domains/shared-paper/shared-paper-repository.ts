import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { sharedPaperEdits, sharedPapers, users } from "../../database/schema.js";
import {
  lockAndReadMcpIdempotency,
  recordMcpIdempotency,
  type McpIdempotencyTransaction,
} from "../mcp-write/mcp-write-idempotency.js";
import { requireActiveUserInTransaction } from "../require-active-user-transaction.js";
import { codePointLength, replaceCodePointRange, sliceCodePoints } from "../../shared/unicode.js";
import type {
  SharedPaperCreateIdempotencyInput,
  SharedPaperCreateInput,
  SharedPaperEdit,
  SharedPaperEditIdempotencyInput,
  SharedPaperRangeEditInput,
  SharedPaperRepository,
  SharedPaperRecord,
} from "./shared-paper-types.js";

type Database = ReturnType<typeof createDatabase>["db"];

function toPaper(row: typeof sharedPapers.$inferSelect): SharedPaperRecord {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    content: row.content,
    revision: row.revision,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toEdit(row: typeof sharedPaperEdits.$inferSelect): SharedPaperEdit {
  return {
    id: row.id,
    userId: row.userId,
    paperId: row.paperId,
    baseRevision: row.baseRevision,
    revision: row.revision,
    author: row.author,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
    deletedText: row.deletedText,
    insertedText: row.insertedText,
    createdAt: row.createdAt,
  };
}

export class DrizzleSharedPaperRepository implements SharedPaperRepository {
  constructor(private readonly db: Database) {}

  async findUserById(userId: string): Promise<{ status: "active" | "disabled" } | null> {
    const [user] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
    return user ?? null;
  }

  async listPapers(input: { userId: string; limit?: number }): Promise<SharedPaperRecord[]> {
    const rows = await this.db.select().from(sharedPapers).where(eq(sharedPapers.userId, input.userId)).orderBy(desc(sharedPapers.updatedAt), desc(sharedPapers.id)).limit(input.limit ?? 50);
    return rows.map(toPaper);
  }

  async searchPapers(input: { userId: string; query: string; limit?: number }): Promise<SharedPaperRecord[]> {
    const query = `%${escapeLike(input.query)}%`;
    const normalized = sql`regexp_replace(lower(normalize(${sharedPapers.title} || ' ' || ${sharedPapers.content}, NFC)), '\\s+', ' ', 'g')`;
    const rows = await this.db.select().from(sharedPapers).where(and(eq(sharedPapers.userId, input.userId), sql`${normalized} like ${query} escape '\\'`)).orderBy(desc(sharedPapers.updatedAt), desc(sharedPapers.id)).limit(input.limit ?? 50);
    return rows.map(toPaper);
  }

  async getPaper(input: { userId: string; paperId: string }): Promise<SharedPaperRecord | null> {
    const [row] = await this.db.select().from(sharedPapers).where(and(eq(sharedPapers.userId, input.userId), eq(sharedPapers.id, input.paperId))).limit(1);
    return row ? toPaper(row) : null;
  }

  async listEdits(input: { userId: string; paperId: string; limit?: number }): Promise<SharedPaperEdit[]> {
    const rows = await this.db.select().from(sharedPaperEdits).where(and(eq(sharedPaperEdits.userId, input.userId), eq(sharedPaperEdits.paperId, input.paperId))).orderBy(desc(sharedPaperEdits.revision), desc(sharedPaperEdits.id)).limit(input.limit ?? 100);
    return rows.map(toEdit);
  }

  async createPaper(input: SharedPaperCreateInput): Promise<SharedPaperRecord> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const [row] = await transaction.insert(sharedPapers).values({
        userId: input.userId,
        title: input.title,
        content: input.content,
        createdBy: input.author,
        updatedBy: input.author,
      }).returning();
      if (!row) throw new Error("Shared paper creation failed.");
      return toPaper(row);
    });
  }

  async createPaperIdempotently(input: SharedPaperCreateIdempotencyInput) {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const existing = await lockAndReadMcpIdempotency(transaction, {
        userId: input.userId,
        toolName: "create_shared_paper",
        idempotencyKey: input.idempotencyKey,
      });
      if (existing) {
        if (existing.requestHash !== input.requestHash || existing.resourceType !== "shared_paper") return { outcome: "idempotency_conflict" as const };
        const paper = await this.getPaperInTransaction(transaction as unknown as Database, input.userId, existing.resourceId);
        if (!paper) throw new Error("Idempotent shared paper was not found.");
        return { outcome: "replayed" as const, paper };
      }
      const [row] = await transaction.insert(sharedPapers).values({
        userId: input.userId,
        title: input.title,
        content: input.content,
        createdBy: input.author,
        updatedBy: input.author,
      }).returning();
      if (!row) throw new Error("Shared paper creation failed.");
      const paper = toPaper(row);
      await recordMcpIdempotency(transaction, {
        userId: input.userId,
        toolName: "create_shared_paper",
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        resourceType: "shared_paper",
        resourceId: paper.id,
      });
      return { outcome: "committed" as const, paper };
    });
  }

  async editPaper(input: SharedPaperRangeEditInput) {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      return this.editRangeInTransaction(transaction as unknown as McpIdempotencyTransaction, input);
    });
  }

  async editPaperIdempotently(input: SharedPaperEditIdempotencyInput) {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const existing = await lockAndReadMcpIdempotency(transaction, {
        userId: input.userId,
        toolName: "edit_shared_paper",
        idempotencyKey: input.idempotencyKey,
      });
      if (existing) {
        if (existing.requestHash !== input.requestHash || existing.resourceType !== "shared_paper_edit") return { outcome: "idempotency_conflict" as const };
        const edit = await this.getEditInTransaction(transaction as unknown as Database, input.userId, existing.resourceId);
        if (!edit) throw new Error("Idempotent shared paper edit was not found.");
        const paper = await this.getPaperInTransaction(transaction as unknown as Database, input.userId, edit.paperId);
        if (!paper) throw new Error("Idempotent shared paper was not found.");
        return { outcome: "replayed" as const, paper, edit };
      }
      const paper = await this.lockPaperInTransaction(transaction as unknown as Database, input.userId, input.paperId);
      if (!paper) return { outcome: "not_found" as const };
      if (paper.revision !== input.expectedRevision) return { outcome: "revision_conflict" as const };
      const range = resolveMatch(paper.content, input.matchText);
      if (range === "not_found") return { outcome: "target_not_found" as const };
      if (range === "ambiguous") return { outcome: "target_ambiguous" as const };
      const result = await this.editRangeInTransaction(transaction as unknown as McpIdempotencyTransaction, {
        userId: input.userId,
        paperId: input.paperId,
        expectedRevision: input.expectedRevision,
        author: input.author,
        start: range.start,
        end: range.end,
        replacement: input.replacementText,
      }, paper);
      if (result.outcome !== "committed") return result;
      await recordMcpIdempotency(transaction, {
        userId: input.userId,
        toolName: "edit_shared_paper",
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        resourceType: "shared_paper_edit",
        resourceId: result.edit.id,
      });
      return result;
    });
  }

  private async editRangeInTransaction(transaction: McpIdempotencyTransaction, input: SharedPaperRangeEditInput, lockedPaper?: SharedPaperRecord) {
    const database = transaction as unknown as Database;
    const paper = lockedPaper ?? await this.lockPaperInTransaction(database, input.userId, input.paperId);
    if (!paper) return { outcome: "not_found" as const };
    if (paper.revision !== input.expectedRevision) return { outcome: "revision_conflict" as const };
    let deleted: string;
    try { deleted = sliceCodePoints(paper.content, input.start, input.end); } catch { return { outcome: "invalid_edit" as const }; }
    if (deleted === input.replacement) return { outcome: "invalid_edit" as const };
    const nextContent = replaceCodePointRange(paper.content, input.start, input.end, input.replacement);
    if (codePointLength(nextContent) > 100_000) return { outcome: "invalid_edit" as const };
    const [editRow] = await (transaction as any).insert(sharedPaperEdits).values({
      userId: input.userId,
      paperId: input.paperId,
      baseRevision: paper.revision,
      revision: paper.revision + 1,
      author: input.author,
      startOffset: input.start,
      endOffset: input.end,
      deletedText: deleted,
      insertedText: input.replacement,
    }).returning();
    const [paperRow] = await (transaction as any).update(sharedPapers).set({
      content: nextContent,
      revision: paper.revision + 1,
      updatedBy: input.author,
      updatedAt: new Date(),
    }).where(and(eq(sharedPapers.userId, input.userId), eq(sharedPapers.id, input.paperId))).returning();
    if (!editRow || !paperRow) throw new Error("Shared paper edit failed.");
    return { outcome: "committed" as const, paper: toPaper(paperRow), edit: toEdit(editRow) };
  }

  private async lockPaperInTransaction(database: Database, userId: string, paperId: string): Promise<SharedPaperRecord | null> {
    const [row] = await database.select().from(sharedPapers).where(and(eq(sharedPapers.userId, userId), eq(sharedPapers.id, paperId))).for("update").limit(1);
    return row ? toPaper(row) : null;
  }

  private async getPaperInTransaction(database: Database, userId: string, paperId: string): Promise<SharedPaperRecord | null> {
    const [row] = await database.select().from(sharedPapers).where(and(eq(sharedPapers.userId, userId), eq(sharedPapers.id, paperId))).limit(1);
    return row ? toPaper(row) : null;
  }

  private async getEditInTransaction(database: Database, userId: string, editId: string): Promise<SharedPaperEdit | null> {
    const [row] = await database.select().from(sharedPaperEdits).where(and(eq(sharedPaperEdits.userId, userId), eq(sharedPaperEdits.id, editId))).limit(1);
    return row ? toEdit(row) : null;
  }
}

function escapeLike(value: string): string { return value.replace(/[\\%_]/g, "\\$&"); }

function resolveMatch(content: string, match: string): { start: number; end: number } | "not_found" | "ambiguous" {
  if (match.length === 0) return content.length === 0 ? { start: 0, end: 0 } : "not_found";
  const first = content.indexOf(match);
  if (first < 0) return "not_found";
  if (content.indexOf(match, first + 1) >= 0) return "ambiguous";
  const start = codePointLength(content.slice(0, first));
  return { start, end: start + codePointLength(match) };
}
