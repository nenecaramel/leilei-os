import assert from "node:assert/strict";
import test from "node:test";
import {
  SharedPaperService,
  SharedPaperServiceError,
} from "../src/domains/shared-paper/shared-paper-service.js";
import type {
  SharedPaperEdit,
  SharedPaperRepository,
  SharedPaperRecord,
} from "../src/domains/shared-paper/shared-paper-types.js";
import { replaceCodePointRange } from "../src/shared/unicode.js";

const paper = (overrides: Partial<SharedPaperRecord> = {}): SharedPaperRecord => ({
  id: "00000000-0000-4000-8000-000000000001",
  userId: "user-1",
  title: "Shared",
  content: "你好 😀",
  revision: 1,
  createdBy: "L",
  updatedBy: "L",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  archivedAt: null,
  ...overrides,
});

class FakeRepository implements SharedPaperRepository {
  current = paper();
  edits: SharedPaperEdit[] = [];
  lastListInput: unknown;
  lastSearchInput: unknown;
  findUserById() { return Promise.resolve({ status: "active" as const }); }
  createPaper(input: Parameters<SharedPaperRepository["createPaper"]>[0]) {
    this.current = paper({ title: input.title, content: input.content, createdBy: input.author, updatedBy: input.author });
    return Promise.resolve(this.current);
  }
  listPapers(input: Parameters<SharedPaperRepository["listPapers"]>[0]) { this.lastListInput = input; return Promise.resolve([this.current]); }
  searchPapers(input: Parameters<SharedPaperRepository["searchPapers"]>[0]) { this.lastSearchInput = input; return Promise.resolve([this.current]); }
  getPaper() { return Promise.resolve(this.current); }
  listEdits(input: Parameters<SharedPaperRepository["listEdits"]>[0]) { this.lastListInput = input; return Promise.resolve(this.edits); }
  archivePaper() {
    this.current = paper({ ...this.current, archivedAt: this.current.archivedAt ?? new Date("2026-01-02T00:00:00Z") });
    return Promise.resolve({ outcome: "committed" as const, paper: this.current });
  }
  restorePaper() {
    this.current = paper({ ...this.current, archivedAt: null });
    return Promise.resolve({ outcome: "committed" as const, paper: this.current });
  }
  deletePaper() {
    if (!this.current.archivedAt) return Promise.resolve({ outcome: "not_archived" as const });
    return Promise.resolve({ outcome: "deleted" as const });
  }
  editPaper(input: Parameters<SharedPaperRepository["editPaper"]>[0]) {
    if (input.expectedRevision !== this.current.revision) return Promise.resolve({ outcome: "revision_conflict" as const });
    const target = input.target ?? "content";
    const source = target === "title" ? this.current.title : this.current.content;
    const points = Array.from(source);
    const deletedText = points.slice(input.start, input.end).join("");
    const nextValue = replaceCodePointRange(source, input.start, input.end, input.replacement);
    const nextRevision = this.current.revision + 1;
    const next = paper({ ...this.current, ...(target === "title" ? { title: nextValue } : { content: nextValue }), revision: nextRevision, updatedBy: input.author });
    const edit: SharedPaperEdit = { id: "00000000-0000-4000-8000-000000000002", userId: "user-1", paperId: this.current.id, baseRevision: this.current.revision, revision: nextRevision, author: input.author, target, startOffset: input.start, endOffset: input.end, deletedText, insertedText: input.replacement, createdAt: new Date("2026-01-01T00:00:00Z") };
    this.current = next;
    this.edits.push(edit);
    return Promise.resolve({ outcome: "committed" as const, paper: next, edit });
  }
}

test("SharedPaperService keeps one canonical paper across authors and records Unicode delta", async () => {
  const repository = new FakeRepository();
  const service = new SharedPaperService(repository);
  const result = await service.editPaperByMatch({ userId: "user-1", paperId: paper().id, expectedRevision: 1, author: "G", matchText: "你好", replacementText: "世界", idempotencyKey: "shared.paper:edit-0001" });
  assert.equal(result.paper.content, "世界 😀");
  assert.equal(result.paper.revision, 2);
  assert.equal(result.edit.author, "G");
  assert.equal(result.edit.deletedText, "你好");
  assert.equal(result.edit.startOffset, 0);
  assert.equal(result.edit.endOffset, 2);
  assert.equal(result.paper.updatedBy, "G");
});

test("SharedPaperService edits titles through the same revisioned journal", async () => {
  const repository = new FakeRepository();
  const service = new SharedPaperService(repository);
  const result = await service.editPaperByMatch({ userId: "user-1", paperId: paper().id, expectedRevision: 1, author: "C", target: "title", matchText: "Shared", replacementText: "共同纸", idempotencyKey: "shared.paper:title-0001" });
  assert.equal(result.paper.title, "共同纸");
  assert.equal(result.paper.revision, 2);
  assert.equal(result.edit.target, "title");
  assert.equal(result.edit.deletedText, "Shared");
  assert.equal(result.edit.insertedText, "共同纸");
});

test("SharedPaperService rejects stale, empty, and ambiguous match edits", async () => {
  const repository = new FakeRepository();
  const service = new SharedPaperService(repository);
  await assert.rejects(() => service.editPaperByMatch({ userId: "user-1", paperId: paper().id, expectedRevision: 0, author: "C", matchText: "你好", replacementText: "x", idempotencyKey: "shared.paper:edit-0002" }), (error: unknown) => error instanceof SharedPaperServiceError && error.code === "PAPER_REVISION_CONFLICT");
  await assert.rejects(() => service.editPaperByMatch({ userId: "user-1", paperId: paper().id, expectedRevision: 1, author: "C", matchText: "missing", replacementText: "x", idempotencyKey: "shared.paper:edit-0003" }), (error: unknown) => error instanceof SharedPaperServiceError && error.code === "PAPER_EDIT_TARGET_NOT_FOUND");
  repository.current = paper({ content: "x x" });
  await assert.rejects(() => service.editPaperByMatch({ userId: "user-1", paperId: paper().id, expectedRevision: 1, author: "C", matchText: "x", replacementText: "y", idempotencyKey: "shared.paper:edit-0004" }), (error: unknown) => error instanceof SharedPaperServiceError && error.code === "PAPER_EDIT_TARGET_AMBIGUOUS");
  repository.current = paper({ content: "aaa" });
  await assert.rejects(() => service.editPaperByMatch({ userId: "user-1", paperId: paper().id, expectedRevision: 1, author: "C", matchText: "aa", replacementText: "b", idempotencyKey: "shared.paper:edit-0006" }), (error: unknown) => error instanceof SharedPaperServiceError && error.code === "PAPER_EDIT_TARGET_AMBIGUOUS");
  repository.current = paper({ content: "" });
  const inserted = await service.editPaperByMatch({ userId: "user-1", paperId: paper().id, expectedRevision: 1, author: "C", matchText: "", replacementText: "😀", idempotencyKey: "shared.paper:edit-0005" });
  assert.equal(inserted.edit.endOffset, 0);
});

test("SharedPaperService rejects non-string create fields with a stable validation error", async () => {
  const service = new SharedPaperService(new FakeRepository());
  await assert.rejects(
    () => service.createPaper({ userId: "user-1", title: null as unknown as string, content: "", author: "L" }),
    (error: unknown) => error instanceof SharedPaperServiceError && error.code === "INVALID_SHARED_PAPER",
  );
});

test("SharedPaperService forwards a before_revision history cursor", async () => {
  const repository = new FakeRepository();
  const service = new SharedPaperService(repository);
  await service.listEdits({ userId: "user-1", paperId: paper().id, limit: 2, beforeRevision: 3 });
  assert.deepEqual(repository.lastListInput, { userId: "user-1", paperId: paper().id, limit: 2, beforeRevision: 3 });
});


test("SharedPaperService defaults discovery to active and forwards archived scope", async () => {
  const repository = new FakeRepository();
  const service = new SharedPaperService(repository);
  await service.listPapers({ userId: "user-1" });
  assert.deepEqual(repository.lastListInput, { userId: "user-1", limit: 50, scope: "active" });
  await service.searchPapers({ userId: "user-1", query: "shared", scope: "archived" });
  assert.deepEqual(repository.lastSearchInput, { userId: "user-1", query: "shared", limit: 50, scope: "archived" });
});

test("SharedPaperService archives and restores without changing content revision, and only hard-deletes archived papers", async () => {
  const repository = new FakeRepository();
  const service = new SharedPaperService(repository);
  const archived = await service.archivePaper({ userId: "user-1", paperId: paper().id });
  assert.ok(archived.archivedAt instanceof Date);
  assert.equal(archived.revision, 1);
  const restored = await service.restorePaper({ userId: "user-1", paperId: paper().id });
  assert.equal(restored.archivedAt, null);
  assert.equal(restored.revision, 1);
  await assert.rejects(
    () => service.deletePaper({ userId: "user-1", paperId: paper().id }),
    (error: unknown) => error instanceof SharedPaperServiceError && error.code === "PAPER_NOT_ARCHIVED",
  );
  await service.archivePaper({ userId: "user-1", paperId: paper().id });
  const deleted = await service.deletePaper({ userId: "user-1", paperId: paper().id });
  assert.deepEqual(deleted, { paperId: paper().id });
});
