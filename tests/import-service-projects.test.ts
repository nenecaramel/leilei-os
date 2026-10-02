import assert from "node:assert/strict";
import test from "node:test";
import {
  ImportService,
} from "../src/domains/import/import-service.js";
import {
  USER_ID,
  NOW,
  diary,
  todo,
  CONVERSATION_ID,
  projectBundle,
  canonicalProjectBundle,
  v3PackageBytes,
  v4PackageBytes,
  FakeImportRepository,
} from "./helpers/import-service-fixtures.js";

test("v4 preview exposes file metadata and restores single-layer Workspaces", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    projects: {
      workspaces: [],
      projects: [],
      resources: [],
      conversations: [],
    },
    native_live_conversation_ids:
      new Set([CONVERSATION_ID]),
  });
  const service = new ImportService(repository);
  const raw = v4PackageBytes();

  const preview = await service.preview(raw, USER_ID);
  assert.equal(preview.schema_version, 4);
  assert.equal(preview.exported_at, NOW);
  assert.equal(preview.raw_bytes, raw.length);
  assert.deepEqual(preview.included_modules, ["workspaces"]);
  assert.equal(preview.audit_included, false);
  assert.deepEqual(preview.summary.workspaces, {
    create: 3,
    duplicate: 0,
    conflict: 0,
    invalid: 0,
  });
  assert.equal(preview.can_execute, true);

  const result = await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );
  assert.equal(result.schema_version, 4);
  assert.equal(result.exported_at, NOW);
  assert.equal(result.raw_bytes, raw.length);
  assert.deepEqual(result.included_modules, ["workspaces"]);
  assert.equal(result.audit_included, false);
  assert.equal(result.summary.workspaces?.create, 3);
  assert.deepEqual(repository.state.projects, canonicalProjectBundle);
  assert.equal(repository.writes, 3);
  assert.equal(repository.audits[0]?.schema_version, 4);
});

test("v3 preview and execute restore Projects atomically with exact product state", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    projects: {
      workspaces: [],
      projects: [],
      resources: [],
      conversations: [],
    },
    native_live_conversation_ids:
      new Set([CONVERSATION_ID]),
  });
  const service = new ImportService(repository);
  const raw = v3PackageBytes();

  const preview = await service.preview(raw, USER_ID);
  assert.deepEqual(preview.summary.workspaces, {
    create: 3,
    duplicate: 0,
    conflict: 0,
    invalid: 0,
  });
  assert.equal(preview.can_execute, true);

  const result = await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );

  assert.equal(result.summary.workspaces?.create, 3);
  assert.deepEqual(repository.state.projects, canonicalProjectBundle);
  assert.equal(repository.writes, 3);
  assert.equal(repository.audits[0]?.schema_version, 3);
});

test("v3 Projects preview rejects cross-user ids before any write", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    projects: {
      workspaces: [],
      projects: [],
      resources: [],
      conversations: [],
    },
    foreign_workspace_ids:
      new Set([projectBundle.projects[0]!.id]),
    native_live_conversation_ids:
      new Set([CONVERSATION_ID]),
  });
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes(),
    USER_ID,
  );

  assert.equal(preview.summary.workspaces?.conflict, 1);
  assert.equal(preview.can_execute, false);
  assert.equal(repository.writes, 0);
});
