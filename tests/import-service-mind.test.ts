import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExportMindStateRecord,
} from "../src/domains/export/export-types.js";
import {
  ImportService,
} from "../src/domains/import/import-service.js";
import {
  USER_ID,
  diary,
  todo,
  universeBundle,
  mindState,
  driveState,
  driveCandidateState,
  conversationBundle,
  mindContinuity,
  projectBundle,
  canonicalProjectBundle,
  v3PackageBytes,
  FakeImportRepository,
  watermarkOnlyContinuity,
  emptyContinuityRepository,
} from "./helpers/import-service-fixtures.js";

test("v3 Mind restore preserves durable state semantics exactly", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    mind: [],
  });
  const service = new ImportService(repository);
  const raw = v3PackageBytes({
    mind: [mindState],
  });

  const preview = await service.preview(raw, USER_ID);
  assert.deepEqual(preview.summary.mind, {
    create: 1,
    duplicate: 0,
    conflict: 0,
    invalid: 0,
  });

  await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );

  assert.deepEqual(repository.state.mind, [mindState]);
  assert.equal(repository.writes, 1);
});

test("v3 Mind restore rejects a state id owned by another user", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    mind: [],
    foreign_mind_ids: new Set([mindState.id]),
  });
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes({ mind: [mindState] }),
    USER_ID,
  );

  assert.equal(preview.summary.mind?.conflict, 1);
  assert.equal(preview.can_execute, false);
  assert.equal(repository.writes, 0);
});

test("v3 all-state restore creates canonical conversations before Project membership", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    projects: {
      workspaces: [],
      projects: [],
      resources: [],
      conversations: [],
    },
    mind: [],
    conversations: {
      conversations: [],
      messages: [],
      content_blocks: [],
      attachments: [],
      provider_checkpoints: [],
    },
    native_live_conversation_ids: new Set(),
  });
  const service = new ImportService(repository);
  const raw = v3PackageBytes({
    conversations: conversationBundle,
    projects: projectBundle,
    mind: [mindState],
    diary: [diary],
    universe: universeBundle,
  });

  const preview = await service.preview(raw, USER_ID);
  assert.deepEqual(preview.summary.conversations, {
    create: 6,
    duplicate: 0,
    conflict: 0,
    invalid: 0,
  });
  assert.deepEqual(preview.summary.workspaces, {
    create: 3,
    duplicate: 0,
    conflict: 0,
    invalid: 0,
  });
  assert.equal(preview.can_execute, true);

  await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );

  assert.deepEqual(
    repository.state.conversations,
    conversationBundle,
  );
  assert.deepEqual(
    repository.state.projects,
    canonicalProjectBundle,
  );
  assert.deepEqual(repository.state.mind, [mindState]);
  assert.deepEqual(repository.state.universe, universeBundle);
  assert.equal(repository.writes, 12);
});

test("v3 scoped Mind restore preserves historical scope even after source deletion", async () => {
  const historical: ExportMindStateRecord = {
    ...mindState,
    id: "00000000-0000-4000-8000-000000000063",
    scope_applicability: "path",
    scope_conversation_id:
      "00000000-0000-4000-8000-000000000097",
    scope_path_head_message_id:
      "00000000-0000-4000-8000-000000000098",
  };
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    mind: [],
    conversations: {
      conversations: [],
      messages: [],
      content_blocks: [],
      attachments: [],
      provider_checkpoints: [],
    },
  });
  const service = new ImportService(repository);
  const raw = v3PackageBytes({
    mind: [historical],
  });

  const preview = await service.preview(raw, USER_ID);
  assert.equal(preview.summary.mind?.create, 1);
  assert.equal(preview.summary.mind?.invalid, 0);
  assert.equal(preview.can_execute, true);

  await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );
  assert.deepEqual(repository.state.mind, [historical]);
});

test("v3 packages carrying a retired Mind kind are rejected at preview", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    mind: [],
  });
  const service = new ImportService(repository);

  await assert.rejects(
    service.preview(
      v3PackageBytes({ mind: [driveState] }),
      USER_ID,
    ),
    (error: unknown) =>
      error instanceof Error
      && "code" in error
      && (error as { code: string }).code === "INVALID_IMPORT_FILE",
  );
  assert.equal(repository.writes, 0);
});

test("v3 Mind continuity still restores a historical watermark after its canonical conversation", async () => {
  const repository = emptyContinuityRepository();
  const service = new ImportService(repository);
  const raw = v3PackageBytes({
    conversations: conversationBundle,
    mind_continuity: watermarkOnlyContinuity,
  });

  const preview = await service.preview(raw, USER_ID);
  assert.equal(preview.can_execute, true);
  await service.execute(raw, USER_ID, preview.preview_fingerprint);

  assert.deepEqual(
    repository.state.mind_continuity?.distillation_watermarks,
    watermarkOnlyContinuity.distillation_watermarks,
  );
});

test("v3 Mind continuity rejects a historical watermark without canonical evidence", async () => {
  const repository = emptyContinuityRepository();
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes({ mind_continuity: watermarkOnlyContinuity }),
    USER_ID,
  );

  assert.equal(preview.can_execute, false);
  assert.ok((preview.summary.mind?.invalid ?? 0) >= 1);
  assert.equal(repository.writes, 0);
});

test("v3 semantic grouping restore conflicts with an occupied nonterminal grouping key", async () => {
  const grouping =
    mindContinuity.semantic_grouping_results[0]!;
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    mind: [driveCandidateState, driveState],
    mind_continuity: {
      drive_satisfaction_events: [],
      curiosity_resolution_events: [],
      distillation_watermarks: [],
      semantic_grouping_results: [],
    },
    occupied_semantic_grouping_keys: new Set([
      `${grouping.subject_id}:${grouping.kind}:${grouping.query_state_id}`,
    ]),
  });
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes({
      mind_continuity: {
        drive_satisfaction_events: [],
        curiosity_resolution_events: [],
        distillation_watermarks: [],
        semantic_grouping_results: [grouping],
      },
    }),
    USER_ID,
  );

  assert.equal(preview.summary.mind?.conflict, 1);
  assert.equal(preview.can_execute, false);
  assert.equal(repository.writes, 0);
});
