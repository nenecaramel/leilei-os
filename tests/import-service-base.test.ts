import assert from "node:assert/strict";
import test from "node:test";
import {
  ImportService,
} from "../src/domains/import/import-service.js";
import {
  ImportValidationError,
} from "../src/domains/import/import-schema.js";
import {
  USER_ID,
  diary,
  todo,
  packageBytes,
  FakeImportRepository,
} from "./helpers/import-service-fixtures.js";

test("preview reports active Diary and Todo creates", async () => {
  const repository =
    new FakeImportRepository();
  const service =
    new ImportService(repository);

  const preview = await service.preview(
    packageBytes(),
    USER_ID,
  );

  assert.equal(preview.summary.diary.create, 1);
  assert.equal(preview.summary.todo.create, 1);
  assert.equal(preview.can_execute, true);
  assert.equal(repository.writes, 0);
});

test("execute restores active modules and records safe audit metadata", async () => {
  const repository =
    new FakeImportRepository();
  const service =
    new ImportService(repository);
  const raw = packageBytes();

  const preview = await service.preview(
    raw,
    USER_ID,
  );
  const result = await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );

  assert.equal(result.summary.diary.create, 1);
  assert.equal(result.summary.todo.create, 1);
  assert.deepEqual(repository.state.diary, [diary]);
  assert.deepEqual(repository.state.todo, [todo]);
  assert.equal(repository.writes, 2);
  assert.equal(repository.audits.length, 1);
  assert.equal(
    JSON.stringify(repository.audits[0]).includes(
      diary.content,
    ),
    false,
  );
});

test("execute preserves C author values", async () => {
  const repository =
    new FakeImportRepository();
  const service =
    new ImportService(repository);
  const raw = packageBytes();

  const preview = await service.preview(
    raw,
    USER_ID,
  );
  await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );

  assert.equal(
    repository.state.diary[0]?.author,
    "C",
  );
  assert.equal(
    repository.state.todo[0]?.author,
    "C",
  );
});

test("execute rejects a stale preview and rolls back", async () => {
  const repository =
    new FakeImportRepository();
  const service =
    new ImportService(repository);
  const raw = packageBytes();

  const preview = await service.preview(
    raw,
    USER_ID,
  );
  repository.state.diary.push({
    ...diary,
    content: "Concurrent replacement",
  });

  await assert.rejects(
    service.execute(
      raw,
      USER_ID,
      preview.preview_fingerprint,
    ),
    (error: unknown) =>
      error instanceof ImportValidationError
      && error.code === "IMPORT_PREVIEW_STALE",
  );
  assert.equal(repository.writes, 0);
});

test("execute keeps a preview valid across unrelated concurrent records", async () => {
  const repository = new FakeImportRepository();
  const service = new ImportService(repository);
  const raw = packageBytes();

  const preview = await service.preview(
    raw,
    USER_ID,
  );
  repository.state.diary.push({
    ...diary,
    id: "00000000-0000-4000-8000-000000000032",
    title: "Unrelated",
  });

  await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );

  assert.equal(
    repository.state.diary.some(
      (record) =>
        record.id
        === "00000000-0000-4000-8000-000000000032",
    ),
    true,
  );
  assert.equal(
    repository.state.diary.some(
      (record) => record.id === diary.id,
    ),
    true,
  );
});

test("execute rejects duplicate-only packages", async () => {
  const repository =
    new FakeImportRepository({
      diary: [diary],
      todo: [todo],
    });
  const service =
    new ImportService(repository);
  const raw = packageBytes();

  const preview = await service.preview(
    raw,
    USER_ID,
  );
  assert.equal(preview.can_execute, false);

  await assert.rejects(
    service.execute(
      raw,
      USER_ID,
      preview.preview_fingerprint,
    ),
    (error: unknown) =>
      error instanceof ImportValidationError
      && error.code
        === "IMPORT_NOTHING_TO_RESTORE",
  );
});

test("retired module records are rejected during preview", async () => {
  const repository =
    new FakeImportRepository();
  const service =
    new ImportService(repository);

  for (const data of [
    { memory: [] },
    { task: [] },
    { shared_paper: [] },
  ]) {
    await assert.rejects(
      service.preview(
        packageBytes(data),
        USER_ID,
      ),
      (error: unknown) =>
        error instanceof ImportValidationError
        && error.code === "INVALID_IMPORT_FILE",
    );
  }

  assert.equal(repository.writes, 0);
});

test("disabled users cannot preview imports", async () => {
  const repository =
    new FakeImportRepository();
  repository.status = "disabled";
  const service =
    new ImportService(repository);

  await assert.rejects(
    service.preview(
      packageBytes(),
      USER_ID,
    ),
  );
});

for (const version of [2, 3, 4]) {
  test(`historical v${version} audit is readable but never restored as product records`, async () => {
    const base = JSON.parse(new TextDecoder().decode(packageBytes()));
    const audit = {
      lifecycle: [{ id: "00000000-0000-4000-8000-000000000090", resource_type: "diary", resource_id: diary.id, action: "archive", actor_type: "user", channel: "web", created_at: base.exported_at }],
      tool_activity: [{ id: "00000000-0000-4000-8000-000000000091", tool_name: "write_diary", operation: "create", resource_type: "diary", resource_id: diary.id, status: "success", error_code: null, created_at: base.exported_at }],
    };
    const raw = new TextEncoder().encode(JSON.stringify({ ...base, schema_version: version, audit }));
    const repository = new FakeImportRepository();
    const service = new ImportService(repository);
    const preview = await service.preview(raw, USER_ID);
    assert.equal(preview.audit_included, true);
    assert.equal(preview.can_execute, true);
    assert.equal(repository.writes, 0);
    await service.execute(raw, USER_ID, preview.preview_fingerprint);
    assert.deepEqual(repository.state.diary, [diary]);
    assert.deepEqual(repository.state.todo, [todo]);
    assert.equal(repository.writes, 2);
    assert.equal(repository.audits.length, 1); // The existing safe restore-run record, not imported logs.
    assert.ok(!JSON.stringify(repository.audits).includes("00000000-0000-4000-8000-000000000090"));
    assert.ok(!JSON.stringify(repository.audits).includes("00000000-0000-4000-8000-000000000091"));
  });
}
