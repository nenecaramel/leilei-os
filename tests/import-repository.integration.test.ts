import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { DrizzleExportRepository } from "../src/domains/export/export-repository.js";
import { ExportService } from "../src/domains/export/export-service.js";
import { DrizzleImportRepository } from "../src/domains/import/import-repository.js";
import { ImportService } from "../src/domains/import/import-service.js";

const databaseUrl = process.env.DATABASE_URL;
const parsedUrl = databaseUrl ? new URL(databaseUrl) : null;
const runIntegration =
  process.env.RUN_IMPORT_DATABASE_TEST === "1"
  && Boolean(databaseUrl)
  && (
    parsedUrl?.hostname === "127.0.0.1"
    || parsedUrl?.hostname === "localhost"
  );

test(
  "real import repository round-trips Diary and Todo only",
  { skip: !runIntegration },
  async () => {
    const client = postgres(
      databaseUrl!,
      { max: 1, prepare: false, ssl: false },
    );
    const db = drizzle(client, { schema });
    const userId = randomUUID();
    const diaryId = randomUUID();
    const paperId = randomUUID();
    const now =
      new Date("2026-08-14T00:00:00.000Z");

    try {
      await db.insert(schema.users).values({
        id: userId,
        email:
          `import-active-${userId}@example.invalid`,
        displayName: "Import active modules",
        status: "active",
      });

      await db.insert(schema.diaryEntries).values({
        id: diaryId,
        userId,
        title: "Round trip diary",
        content: "Diary content",
        date: "2026-08-13",
        tags: ["roundtrip"],
        mood: null,
        source: "chatgpt_mcp",
        author: "C",
        status: "active",
        idempotencyKey:
          `roundtrip-diary-${userId}`,
        requestHash: "a".repeat(64),
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(schema.todoPapers).values({
        id: paperId,
        userId,
        businessDate: "2026-08-13",
        author: "C",
        revision: 2,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.todoEntries).values({
        paperId,
        entryId: "entry-1",
        kind: "pending",
        text: "Round trip todo",
        position: 0,
      });

      const exported = await new ExportService(
        new DrizzleExportRepository(
          db as never,
        ),
        () => now,
      ).createExport(userId, "all", false);

      assert.deepEqual(
        Object.keys(exported.data),
        ["diary", "todo"],
      );

      await db
        .delete(schema.todoPapers)
        .where(eq(schema.todoPapers.userId, userId));
      await db
        .delete(schema.diaryEntries)
        .where(eq(schema.diaryEntries.userId, userId));

      const raw = new TextEncoder().encode(
        JSON.stringify(exported),
      );
      const service = new ImportService(
        new DrizzleImportRepository(
          db as never,
        ),
      );
      const preview = await service.preview(
        raw,
        userId,
      );

      assert.equal(
        preview.summary.diary.create,
        1,
      );
      assert.equal(
        preview.summary.todo.create,
        1,
      );

      await service.execute(
        raw,
        userId,
        preview.preview_fingerprint,
      );

      const [diaryCount] = await db
        .select({ count: count() })
        .from(schema.diaryEntries)
        .where(
          eq(schema.diaryEntries.userId, userId),
        );
      const [todoCount] = await db
        .select({ count: count() })
        .from(schema.todoPapers)
        .where(
          eq(schema.todoPapers.userId, userId),
        );

      assert.equal(diaryCount?.count, 1);
      assert.equal(todoCount?.count, 1);

      const [restoredDiary] = await db
        .select({
          author: schema.diaryEntries.author,
          content: schema.diaryEntries.content,
        })
        .from(schema.diaryEntries)
        .where(
          eq(schema.diaryEntries.id, diaryId),
        );
      assert.deepEqual(restoredDiary, {
        author: "C",
        content: "Diary content",
      });

      const [restoredPaper] = await db
        .select({
          author: schema.todoPapers.author,
          revision: schema.todoPapers.revision,
        })
        .from(schema.todoPapers)
        .where(
          eq(schema.todoPapers.userId, userId),
        );
      assert.deepEqual(restoredPaper, {
        author: "C",
        revision: 2,
      });
    } finally {
      await db
        .delete(schema.todoPapers)
        .where(eq(schema.todoPapers.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.diaryEntries)
        .where(eq(schema.diaryEntries.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.dataImportRuns)
        .where(eq(schema.dataImportRuns.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.users)
        .where(eq(schema.users.id, userId))
        .catch(() => undefined);
      await client.end();
    }
  },
);
