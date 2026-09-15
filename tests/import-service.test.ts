import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExportDiaryRecord,
  ExportMemoryRecord,
  ExportSharedPaper,
  ExportTaskRecord,
  ExportTodoPaper,
} from "../src/domains/export/export-types.js";
import { createOwnerFingerprint } from "../src/domains/export/owner-fingerprint.js";
import { ImportService } from "../src/domains/import/import-service.js";
import type { ImportAuditRun, ImportRepository } from "../src/domains/import/import-repository.js";
import type { ImportCurrentState } from "../src/domains/import/import-planner.js";
import { parseImportPackage } from "../src/domains/import/import-schema.js";

const USER_ID = "user-import-service";
const memory: ExportMemoryRecord = {
  id: "00000000-0000-4000-8000-000000000011", category: "profile", key: "name", content: "Leilei",
  tags: [], visibility: "assistant", source: "web", author: "L", status: "active", sort_order: 0,
  created_at: "2026-08-14T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z",
};
const sharedPaper: ExportSharedPaper = {
  id: "00000000-0000-4000-8000-000000000044",
  title: "Shared import",
  content: "Canonical shared paper content",
  revision: 3,
  created_by: "L",
  updated_by: "C",
  created_at: "2026-08-14T00:00:00.000Z",
  updated_at: "2026-08-15T00:00:00.000Z",
  archived_at: "2026-08-16T00:00:00.000Z",
};
const empty: ImportCurrentState = { memory: [], diary: [], task: [], todo: [], shared_paper: [] };

function packageBytes(record = memory): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    schema_version: 2,
    owner_fingerprint: createOwnerFingerprint(USER_ID),
    exported_at: "2026-08-14T00:00:00.000Z",
    data: { memory: [record] },
  }));
}

function cloneState(state: ImportCurrentState): ImportCurrentState {
  return {
    memory: structuredClone(state.memory), diary: structuredClone(state.diary), task: structuredClone(state.task), todo: structuredClone(state.todo), shared_paper: structuredClone(state.shared_paper),
    foreign_memory_ids: new Set(state.foreign_memory_ids), foreign_diary_ids: new Set(state.foreign_diary_ids), foreign_task_ids: new Set(state.foreign_task_ids), foreign_shared_paper_ids: new Set(state.foreign_shared_paper_ids),
  };
}

class FakeImportRepository implements ImportRepository {
  writes = 0;
  audits: ImportAuditRun[] = [];
  constructor(public state: ImportCurrentState = cloneState(empty)) {}
  async findUserById() { return { status: "active" as const }; }
  async withTransaction<T>(work: (repository: ImportRepository) => Promise<T>): Promise<T> {
    const transaction = new FakeImportRepository(cloneState(this.state));
    const result = await work(transaction);
    this.state = transaction.state;
    this.writes += transaction.writes;
    this.audits.push(...transaction.audits);
    return result;
  }
  async readCurrentState() { return cloneState(this.state); }
  async insertMemory(_userId: string, record: ExportMemoryRecord) { this.state.memory.push(record); this.writes += 1; }
  async insertDiary(_userId: string, record: ExportDiaryRecord) { this.state.diary.push(record); this.writes += 1; }
  async insertTask(_userId: string, record: ExportTaskRecord) { this.state.task.push(record); this.writes += 1; }
  async insertTodo(_userId: string, record: ExportTodoPaper) { this.state.todo.push(record); this.writes += 1; }
  async insertSharedPaper(_userId: string, record: ExportSharedPaper) { this.state.shared_paper.push(record); this.writes += 1; }
  async rereadCreatedState(userId: string, modules: Set<keyof ImportCurrentState>) {
    const state = await this.readCurrentState(userId);
    return { memory: modules.has("memory") ? state.memory : [], diary: modules.has("diary") ? state.diary : [], task: modules.has("task") ? state.task : [], todo: modules.has("todo") ? state.todo : [], shared_paper: modules.has("shared_paper") ? state.shared_paper : [] };
  }
  async recordAuditRun(_userId: string, run: ImportAuditRun) { this.audits.push(run); }
}

test("preview performs no writes and returns only aggregate planning data", async () => {
  const repository = new FakeImportRepository();
  const preview = await new ImportService(repository).preview(packageBytes(), USER_ID);
  assert.equal(repository.writes, 0);
  assert.equal(repository.audits.length, 0);
  assert.equal(preview.summary.memory.create, 1);
  assert.equal("items" in preview, false);
});

test("execute inserts creates and records exactly one thin audit row", async () => {
  const repository = new FakeImportRepository();
  const service = new ImportService(repository);
  const raw = packageBytes();
  const preview = await service.preview(raw, USER_ID);
  const result = await service.execute(raw, USER_ID, preview.preview_fingerprint);
  assert.equal(result.summary.memory.create, 1);
  assert.equal(repository.state.memory.length, 1);
  assert.equal(repository.audits.length, 1);
  assert.deepEqual(repository.audits[0]?.summary, result.summary);
  assert.equal(JSON.stringify(repository.audits[0]).includes(memory.content), false);
});

test("execute stores a C-authored canonical record unchanged", async () => {
  const repository = new FakeImportRepository();
  const service = new ImportService(repository);
  const raw = packageBytes({ ...memory, author: "C" });
  const preview = await service.preview(raw, USER_ID);
  await service.execute(raw, USER_ID, preview.preview_fingerprint);
  assert.equal(repository.state.memory[0]?.author, "C");
});

test("stale preview and conflicts perform no writes", async () => {
  const repository = new FakeImportRepository();
  const service = new ImportService(repository);
  const raw = packageBytes();
  const preview = await service.preview(raw, USER_ID);
  await assert.rejects(service.execute(raw, USER_ID, "0".repeat(64)), /IMPORT_PREVIEW_STALE/u);
  assert.equal(repository.writes, 0);
  repository.state.memory.push({ ...memory, content: "changed" });
  const conflictPreview = await service.preview(raw, USER_ID);
  await assert.rejects(service.execute(raw, USER_ID, conflictPreview.preview_fingerprint), /IMPORT_CONFLICT/u);
  assert.equal(repository.writes, 0);
});

test("an all-duplicate package is not reported as a successful restore", async () => {
  const repository = new FakeImportRepository({ ...cloneState(empty), memory: [memory] });
  const service = new ImportService(repository);
  const raw = packageBytes();
  const preview = await service.preview(raw, USER_ID);
  assert.equal(preview.can_execute, false);
  await assert.rejects(service.execute(raw, USER_ID, preview.preview_fingerprint), /IMPORT_NOTHING_TO_RESTORE/u);
  assert.equal(repository.writes, 0);
});

test("parser output can be reused for deterministic package identity", () => {
  const parsed = parseImportPackage(packageBytes());
  assert.equal(parsed.package_sha256.length, 64);
});

function sharedPaperPackage(record = sharedPaper): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    schema_version: 2,
    owner_fingerprint: createOwnerFingerprint(USER_ID),
    exported_at: "2026-08-14T00:00:00.000Z",
    data: { shared_paper: [record] },
  }));
}

test("preview accepts a dedicated Shared Paper export", async () => {
  const repository = new FakeImportRepository();
  const preview = await new ImportService(repository).preview(sharedPaperPackage(), USER_ID);
  assert.equal(preview.can_execute, true);
  assert.deepEqual(preview.summary.shared_paper, { create: 1, duplicate: 0, conflict: 0, invalid: 0 });
  assert.equal(repository.writes, 0);
});

test("execute restores active and archived Shared Papers with canonical metadata", async () => {
  const active = { ...sharedPaper, id: "00000000-0000-4000-8000-000000000045", archived_at: null };
  const repository = new FakeImportRepository();
  const service = new ImportService(repository);
  const raw = sharedPaperPackage(active);
  const preview = await service.preview(raw, USER_ID);
  await service.execute(raw, USER_ID, preview.preview_fingerprint);
  const archivedRaw = sharedPaperPackage();
  const archivedPreview = await service.preview(archivedRaw, USER_ID);
  await service.execute(archivedRaw, USER_ID, archivedPreview.preview_fingerprint);
  assert.deepEqual(repository.state.shared_paper, [active, sharedPaper]);
  assert.equal(repository.state.shared_paper[1]?.revision, 3);
  assert.equal(repository.state.shared_paper[1]?.created_by, "L");
  assert.equal(repository.state.shared_paper[1]?.updated_by, "C");
  assert.equal(repository.state.shared_paper[1]?.created_at, sharedPaper.created_at);
  assert.equal(repository.state.shared_paper[1]?.updated_at, sharedPaper.updated_at);
  assert.equal(repository.state.shared_paper[1]?.archived_at, sharedPaper.archived_at);
});
