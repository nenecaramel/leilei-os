import assert from "node:assert/strict";
import test from "node:test";
import {
  ImportService,
} from "../src/domains/import/import-service.js";
import {
  USER_ID,
  diary,
  diaryComment,
  todo,
  universeBundle,
  v3PackageBytes,
  FakeImportRepository,
} from "./helpers/import-service-fixtures.js";

test("v3 Diary scope restores comments after their parent Diary", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    diary_comments: [],
    todo: [],
  });
  const service = new ImportService(repository);
  const raw = v3PackageBytes({
    diary: [diary],
    diary_comments: [diaryComment],
  });

  const preview = await service.preview(raw, USER_ID);
  assert.equal(preview.summary.diary.create, 1);
  assert.equal(preview.summary.diary_comments?.create, 1);
  assert.equal(preview.can_execute, true);

  await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );

  assert.deepEqual(repository.state.diary, [diary]);
  assert.deepEqual(
    repository.state.diary_comments,
    [diaryComment],
  );
  assert.equal(repository.writes, 2);
});

test("v3 Diary comment without an available parent is invalid", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    diary_comments: [],
    todo: [],
  });
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes({
      diary_comments: [diaryComment],
    }),
    USER_ID,
  );

  assert.equal(preview.summary.diary_comments?.invalid, 1);
  assert.equal(preview.can_execute, false);
  assert.equal(repository.writes, 0);
});

test("v3 Universe restore is atomic no-overwrite product state", async () => {
  const emptyRepository = new FakeImportRepository({
    diary: [diary],
    todo: [],
    universe: null,
  });
  const emptyService = new ImportService(emptyRepository);
  const raw = v3PackageBytes({
    universe: universeBundle,
  });

  const preview = await emptyService.preview(raw, USER_ID);
  assert.deepEqual(preview.summary.universe, {
    create: 1,
    duplicate: 0,
    conflict: 0,
    invalid: 0,
  });
  assert.equal(preview.can_execute, true);

  await emptyService.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );
  assert.deepEqual(
    emptyRepository.state.universe,
    universeBundle,
  );

  const duplicateRepository = new FakeImportRepository({
    diary: [diary],
    todo: [],
    universe: universeBundle,
  });
  const duplicatePreview = await new ImportService(
    duplicateRepository,
  ).preview(raw, USER_ID);
  assert.equal(
    duplicatePreview.summary.universe?.duplicate,
    1,
  );
  assert.equal(duplicatePreview.can_execute, false);

  const conflictRepository = new FakeImportRepository({
    diary: [diary],
    todo: [],
    universe: {
      ...universeBundle,
      version: universeBundle.version + 1,
    },
  });
  const conflictPreview = await new ImportService(
    conflictRepository,
  ).preview(raw, USER_ID);
  assert.equal(
    conflictPreview.summary.universe?.conflict,
    1,
  );
  assert.equal(conflictPreview.can_execute, false);
});

test("v3 Universe provenance rejects a missing Diary parent", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    universe: null,
  });
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes({
      universe: universeBundle,
    }),
    USER_ID,
  );

  assert.equal(preview.summary.universe?.invalid, 1);
  assert.equal(preview.can_execute, false);
  assert.equal(repository.writes, 0);
});
