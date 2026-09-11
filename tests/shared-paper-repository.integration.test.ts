import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/database/schema.js";
import { eq } from "drizzle-orm";
import { DrizzleSharedPaperRepository } from "../src/domains/shared-paper/shared-paper-repository.js";
import { SharedPaperService, SharedPaperServiceError } from "../src/domains/shared-paper/shared-paper-service.js";

const url = process.env.DATABASE_URL;
const host = url ? new URL(url).hostname : "";
const run = process.env.RUN_SHARED_PAPER_DATABASE_TEST === "1" && (host === "localhost" || host === "127.0.0.1");

test("Shared Paper PostgreSQL persistence is transactional, Unicode-safe, and CAS protected", { skip: !run }, async () => {
  const client = postgres(url!, { max: 4, prepare: false, ssl: false });
  const db = drizzle(client, { schema });
  const userId = randomUUID();
  try {
    await db.insert(schema.users).values({ id: userId, email: `shared-paper-${userId}@example.invalid`, displayName: "Shared paper test", status: "active" });
    const service = new SharedPaperService(new DrizzleSharedPaperRepository(db as never));
    const created = await service.createPaperIdempotently({ userId, title: "Canonical", content: "你好 😀", author: "L", idempotencyKey: "shared.paper:create-0001" });
    assert.equal(created.paper.revision, 1);
    assert.ok(created.paper.createdAt instanceof Date);
    const createReplay = await service.createPaperIdempotently({ userId, title: "Canonical", content: "你好 😀", author: "L", idempotencyKey: "shared.paper:create-0001" });
    assert.equal(createReplay.paper.id, created.paper.id);
    await assert.rejects(
      () => service.createPaperIdempotently({ userId, title: "Different", content: "你好 😀", author: "L", idempotencyKey: "shared.paper:create-0001" }),
      (error: unknown) => error instanceof SharedPaperServiceError && error.code === "IDEMPOTENCY_CONFLICT",
    );
    const edited = await service.editPaperByMatch({ userId, paperId: created.paper.id, expectedRevision: 1, author: "C", matchText: "你好", replacementText: "世界", idempotencyKey: "shared.paper:edit-0001" });
    assert.equal(edited.paper.content, "世界 😀");
    assert.equal(edited.edit.baseRevision, 1);
    assert.equal(edited.edit.revision, 2);
    assert.ok(edited.edit.createdAt instanceof Date);
    await assert.rejects(() => service.editPaper({ userId, paperId: created.paper.id, expectedRevision: 1, author: "G", start: 0, end: 1, replacement: "x" }), (error: unknown) => error instanceof SharedPaperServiceError && error.code === "PAPER_REVISION_CONFLICT");
    const replay = await service.editPaperByMatch({ userId, paperId: created.paper.id, expectedRevision: 1, author: "C", matchText: "你好", replacementText: "世界", idempotencyKey: "shared.paper:edit-0001" });
    assert.equal(replay.edit.id, edited.edit.id);
    await assert.rejects(
      () => service.editPaperByMatch({ userId, paperId: created.paper.id, expectedRevision: 1, author: "C", matchText: "你好", replacementText: "不同", idempotencyKey: "shared.paper:edit-0001" }),
      (error: unknown) => error instanceof SharedPaperServiceError && error.code === "IDEMPOTENCY_CONFLICT",
    );
    const rows = await service.listEdits({ userId, paperId: created.paper.id });
    assert.equal(rows.length, 1);

    const concurrent = await Promise.allSettled([
      service.editPaperByMatch({ userId, paperId: created.paper.id, expectedRevision: 2, author: "L", matchText: "世界", replacementText: "宇宙", idempotencyKey: "shared.paper:edit-0002" }),
      service.editPaperByMatch({ userId, paperId: created.paper.id, expectedRevision: 2, author: "G", matchText: "世界", replacementText: "地球", idempotencyKey: "shared.paper:edit-0003" }),
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((result) => result.status === "rejected" && result.reason instanceof SharedPaperServiceError && result.reason.code === "PAPER_REVISION_CONFLICT").length, 1);
    const replayAfterLaterEdit = await service.editPaperByMatch({ userId, paperId: created.paper.id, expectedRevision: 1, author: "C", matchText: "你好", replacementText: "世界", idempotencyKey: "shared.paper:edit-0001" });
    assert.equal(replayAfterLaterEdit.edit.id, edited.edit.id);
    assert.equal(replayAfterLaterEdit.paper.revision, 3);
    assert.equal((await service.listEdits({ userId, paperId: created.paper.id })).length, 2);
    const olderEdits = await service.listEdits({ userId, paperId: created.paper.id, beforeRevision: 3 } as any);
    assert.deepEqual(olderEdits.map((entry) => entry.revision), [2]);
  } finally {
    await db.delete(schema.sharedPaperEdits).where(eq(schema.sharedPaperEdits.userId, userId));
    await db.delete(schema.sharedPapers).where(eq(schema.sharedPapers.userId, userId));
    await db.delete(schema.mcpWriteIdempotency).where(eq(schema.mcpWriteIdempotency.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await client.end();
  }
});
