import assert from "node:assert/strict";
import test from "node:test";
import type {
  HistoricalMindStateRecord,
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
  v4PackageBytes,
  curiosityState,
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

test("v3 all-state restore restores remaining portable modules without Product Workspace", async () => {
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
  assert.deepEqual(repository.state.mind, [mindState]);
  assert.deepEqual(repository.state.universe, universeBundle);
  assert.equal(repository.writes, 9);
});

test("v3 scoped Mind restore preserves historical scope even after source deletion", async () => {
  const historical: HistoricalMindStateRecord = {
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


test("legacy feeling backup restores in place as memory with all other metadata preserved", async () => {
  const repository = new FakeImportRepository({diary:[],todo:[],mind:[]});
  const service = new ImportService(repository);
  const legacy = {...mindState, kind:"feel" as const};
  const raw = v3PackageBytes({mind:[legacy]});
  const preview = await service.preview(raw, USER_ID);
  assert.equal(preview.can_execute,true);
  await service.execute(raw, USER_ID, preview.preview_fingerprint);
  assert.deepEqual(repository.state.mind,[{...legacy,kind:"memory"}]);
});

test("legacy thought backup cannot reintroduce retired state or mutate the database", async () => {
  const repository = new FakeImportRepository({diary:[],todo:[],mind:[]});
  const service = new ImportService(repository);
  const raw = v3PackageBytes({mind:[{...mindState,kind:"thought"}]});
  await assert.rejects(service.preview(raw, USER_ID), /retired kind/);
  await assert.rejects(service.execute(raw, USER_ID, "no-valid-preview"));
  assert.equal(repository.writes,0);
});


// Historical names describe archive events, not current runtime state kinds.
const archivedContinuityMemories = [driveState, curiosityState].map(
  record => ({ ...record, kind: "memory" as const }),
);

for (const [version, bytes] of [[3, v3PackageBytes], [4, v4PackageBytes]] as const) {
  test(`v${version} restores historical Continuity with memory dependencies and archived candidate snapshots`, async () => {
    const repository = emptyContinuityRepository();
    const service = new ImportService(repository);
    // The grouping candidate need not survive; its historical text and score are in the archive.
    const raw = bytes({ mind: archivedContinuityMemories,
      mind_continuity: mindContinuity, conversations: conversationBundle });
    const preview = await service.preview(raw, USER_ID);
    assert.deepEqual(preview.summary.mind, { create: 6, duplicate: 0, conflict: 0, invalid: 0 });
    assert.equal(preview.can_execute, true);
    await service.execute(raw, USER_ID, preview.preview_fingerprint);
    assert.deepEqual(repository.state.mind, archivedContinuityMemories);
    assert.deepEqual(repository.state.mind_continuity, mindContinuity);
    const repeated = await service.preview(raw, USER_ID);
    assert.deepEqual(repeated.summary.mind, { create: 0, duplicate: 6, conflict: 0, invalid: 0 });
    const writes = repository.writes;
    assert.equal(repeated.can_execute, false);
    await assert.rejects(service.execute(raw, USER_ID, repeated.preview_fingerprint), /IMPORT_NOTHING_TO_RESTORE/);
    assert.equal(repository.writes, writes);
  });

  test(`v${version} normalizes feel and preserves Memory metadata and historical scope`, async () => {
    const repository = emptyContinuityRepository();
    const service = new ImportService(repository);
    const legacy = { ...mindState, kind: "feel", text: "  event\nand feeling  ",
      scope_applicability: "path", scope_conversation_id: conversationBundle.conversations[0]!.id,
      scope_path_head_message_id: conversationBundle.messages[1]!.id,
      settlement_status: "unsettled", path_status: "superseded", validity_status: "invalidated",
      payload: { ...mindState.payload, temporal_v1: { occurredAt: "2026-08-01T00:00:00.000Z" } },
      updated_at: "2026-08-15T12:34:56.000Z" };
    const raw = bytes({ mind: [legacy] });
    const preview = await service.preview(raw, USER_ID);
    assert.equal(preview.can_execute, true);
    await service.execute(raw, USER_ID, preview.preview_fingerprint);
    assert.deepEqual(repository.state.mind, [{ ...legacy, kind: "memory" }]);
  });

  test(`v${version} cannot write any retired or unknown Mind kind`, async () => {
    for (const kind of ["drive", "thought", "curiosity", "topic", "unknown"]) {
      const repository = emptyContinuityRepository();
      const service = new ImportService(repository);
      const raw = bytes({ mind: [{ ...mindState, kind }] });
      await assert.rejects(service.preview(raw, USER_ID));
      await assert.rejects(service.execute(raw, USER_ID, "0".repeat(64)));
      assert.equal(repository.writes, 0);
    }
  });
}

test("historical Continuity cannot restore missing state/message/block foreign keys or wrong subjects", async () => {
  const invalidPackages = [
    { mind: [], mind_continuity: mindContinuity, conversations: conversationBundle },
    { mind: archivedContinuityMemories, mind_continuity: mindContinuity },
    { mind: archivedContinuityMemories.map(record => ({ ...record, subject_id: "other" })),
      mind_continuity: mindContinuity, conversations: conversationBundle },
    { mind: archivedContinuityMemories, conversations: conversationBundle,
      mind_continuity: { ...mindContinuity, drive_satisfaction_events: [{
        ...mindContinuity.drive_satisfaction_events[0]!, evidence_kind: "tool_result",
        evidence_block_id: "00000000-0000-4000-8000-000000000099" }] } },
  ];
  for (const data of invalidPackages) {
    const repository = emptyContinuityRepository();
    const service = new ImportService(repository);
    const raw = v4PackageBytes(data);
    const preview = await service.preview(raw, USER_ID);
    assert.equal(preview.can_execute, false);
    assert.ok(preview.summary.mind!.invalid > 0);
    await assert.rejects(service.execute(raw, USER_ID, preview.preview_fingerprint));
    assert.equal(repository.writes, 0);
  }
});

test("Memory conflicts and repeated IDs block the entire add-only archive restore", async () => {
  for (const duplicateId of [false, true]) {
    const repository = emptyContinuityRepository();
    repository.state.mind = duplicateId ? [] : [{ ...archivedContinuityMemories[0]!, text: "keep existing" }];
    const service = new ImportService(repository);
    const raw = v4PackageBytes({
      mind: duplicateId ? [...archivedContinuityMemories, archivedContinuityMemories[0]] : archivedContinuityMemories,
      mind_continuity: mindContinuity, conversations: conversationBundle,
    });
    const before = structuredClone(repository.state.mind);
    const preview = await service.preview(raw, USER_ID);
    assert.equal(preview.can_execute, false);
    assert.equal(duplicateId ? preview.summary.mind!.invalid : preview.summary.mind!.conflict, duplicateId ? 2 : 1);
    await assert.rejects(service.execute(raw, USER_ID, preview.preview_fingerprint));
    assert.deepEqual(repository.state.mind, before);
    assert.equal(repository.writes, 0);
  }
});

test("empty v4 Mind and Continuity preview with nothing to restore", async () => {
  const repository = emptyContinuityRepository();
  const service = new ImportService(repository);
  const raw = v4PackageBytes({ mind: [], mind_continuity: {
    drive_satisfaction_events: [], curiosity_resolution_events: [],
    distillation_watermarks: [], semantic_grouping_results: [] } });
  const preview = await service.preview(raw, USER_ID);
  assert.equal(preview.can_execute, false);
  assert.deepEqual(preview.summary.mind, { create: 0, duplicate: 0, conflict: 0, invalid: 0 });
  await assert.rejects(service.execute(raw, USER_ID, preview.preview_fingerprint), /IMPORT_NOTHING_TO_RESTORE/);
  assert.equal(repository.writes, 0);
});
