import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExportDiaryRecord,
  ExportMemoryRecord,
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
const empty: ImportCurrentState = { memory: [], diary: [], task: [], todo: [] };

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
    memory: structuredClone(state.memory), diary: structuredClone(state.diary), task: structuredClone(state.task), todo: structuredClone(state.todo),
    foreign_memory_ids: new Set(state.foreign_memory_ids), foreign_diary_ids: new Set(state.foreign_diary_ids), foreign_task_ids: new Set(state.foreign_task_ids),
  };
}

class FakeImportRepository implements ImportRepository {
  writes = 0;
  audits: ImportAuditRun[] = [];
  constructor(public state: ImportCurrentState = cloneState(empty)) {}
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
  async rereadCreatedState(userId: string, modules: Set<keyof ImportCurrentState>) {
    const state = await this.readCurrentState(userId);
    return { memory: modules.has("memory") ? state.memory : [], diary: modules.has("diary") ? state.diary : [], task: modules.has("task") ? state.task : [], todo: modules.has("todo") ? state.todo : [] };
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
