import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerFingerprint } from "../src/domains/export/owner-fingerprint.js";
import type {
  ExportDiaryRecord,
  ExportMindStateRecord,
  ExportProjectConversationRecord,
  ExportProjectRecord,
  ExportProjectResourceRecord,
  ExportProjectsBundle,
  ExportProjectWorkspaceRecord,
  ExportTodoPaper,
} from "../src/domains/export/export-types.js";
import {
  ImportService,
} from "../src/domains/import/import-service.js";
import type {
  ImportAuditRun,
  ImportRepository,
} from "../src/domains/import/import-repository.js";
import type {
  ImportCurrentState,
  ImportModule,
} from "../src/domains/import/import-planner.js";
import {
  ImportValidationError,
} from "../src/domains/import/import-schema.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const NOW = "2026-08-14T00:00:00.000Z";

const diary: ExportDiaryRecord = {
  id: "00000000-0000-4000-8000-000000000031",
  title: "Diary",
  content: "Canonical diary content",
  date: "2026-08-13",
  tags: [],
  mood: null,
  source: "web",
  author: "C",
  status: "active",
  created_at: NOW,
  updated_at: NOW,
};

const todo: ExportTodoPaper = {
  date: "2026-08-13",
  author: "C",
  revision: 2,
  created_at: NOW,
  updated_at: NOW,
  entries: [
    { id: "entry-1", kind: "pending", text: "Todo" },
  ],
};

const CONVERSATION_ID =
  "00000000-0000-4000-8000-000000000041";
const mindState: ExportMindStateRecord = {
  id: "00000000-0000-4000-8000-000000000061",
  subject_id: "claude",
  kind: "memory",
  text: "Durable memory",
  payload: {
    lifecycle_v1: {
      status: "active",
      reinforcementCount: 2,
    },
  },
  scope_applicability: "global",
  scope_conversation_id: null,
  scope_path_head_message_id: null,
  settlement_status: "settled",
  path_status: "current",
  validity_status: "valid",
  envelope: {
    authority: "subject_authorized",
    provenance: {
      sources: [{ kind: "conversation_message", id: "source-1" }],
    },
  },
  created_at: NOW,
  updated_at: NOW,
};


const projectBundle: ExportProjectsBundle = {
  workspaces: [{
    id: "00000000-0000-4000-8000-000000000051",
    name: "Workspace",
    description: "Portable workspace",
    version: 3,
    created_at: NOW,
    updated_at: NOW,
  }],
  projects: [{
    id: "00000000-0000-4000-8000-000000000052",
    workspace_id:
      "00000000-0000-4000-8000-000000000051",
    name: "Project",
    description: null,
    version: 2,
    created_at: NOW,
    updated_at: NOW,
  }],
  resources: [{
    id: "00000000-0000-4000-8000-000000000053",
    project_id:
      "00000000-0000-4000-8000-000000000052",
    kind: "file",
    key: "notes/context.md",
    title: "Context",
    content: "project content",
    metadata: { source: "test" },
    version: 4,
    created_at: NOW,
    updated_at: NOW,
  }],
  conversations: [{
    project_id:
      "00000000-0000-4000-8000-000000000052",
    conversation_id: CONVERSATION_ID,
    added_at: NOW,
  }],
};

function packageBytes(
  data: Record<string, unknown> = {
    diary: [diary],
    todo: [todo],
  },
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      schema_version: 2,
      owner_fingerprint:
        createOwnerFingerprint(USER_ID),
      exported_at: NOW,
      data,
    }),
  );
}

function v3PackageBytes(
  data: Record<string, unknown> = {
    projects: projectBundle,
  },
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      schema_version: 3,
      owner_fingerprint:
        createOwnerFingerprint(USER_ID),
      exported_at: NOW,
      data,
    }),
  );
}

function cloneState(
  state: ImportCurrentState,
): ImportCurrentState {
  return {
    diary: structuredClone(state.diary),
    todo: structuredClone(state.todo),
    projects: state.projects
      ? structuredClone(state.projects)
      : undefined,
    mind: state.mind
      ? structuredClone(state.mind)
      : undefined,
    foreign_diary_ids:
      state.foreign_diary_ids
        ? new Set(state.foreign_diary_ids)
        : undefined,
    foreign_workspace_ids:
      state.foreign_workspace_ids
        ? new Set(state.foreign_workspace_ids)
        : undefined,
    foreign_project_ids:
      state.foreign_project_ids
        ? new Set(state.foreign_project_ids)
        : undefined,
    foreign_project_resource_ids:
      state.foreign_project_resource_ids
        ? new Set(state.foreign_project_resource_ids)
        : undefined,
    foreign_mind_ids:
      state.foreign_mind_ids
        ? new Set(state.foreign_mind_ids)
        : undefined,
    native_live_conversation_ids:
      state.native_live_conversation_ids
        ? new Set(state.native_live_conversation_ids)
        : undefined,
  };
}

class FakeImportRepository implements ImportRepository {
  state: ImportCurrentState;
  audits: ImportAuditRun[] = [];
  writes = 0;
  status: "active" | "disabled" = "active";

  constructor(
    initial: ImportCurrentState = {
      diary: [],
      todo: [],
    },
  ) {
    this.state = cloneState(initial);
  }

  async findUserById() {
    return { status: this.status };
  }

  async withTransaction<T>(
    work: (
      repository: ImportRepository,
    ) => Promise<T>,
  ): Promise<T> {
    const snapshot = cloneState(this.state);
    const audits = [...this.audits];
    const writes = this.writes;
    try {
      return await work(this);
    } catch (error) {
      this.state = snapshot;
      this.audits = audits;
      this.writes = writes;
      throw error;
    }
  }

  async readCurrentState() {
    return cloneState(this.state);
  }

  async insertDiary(
    _userId: string,
    record: ExportDiaryRecord,
  ) {
    this.state.diary.push(
      structuredClone(record),
    );
    this.writes += 1;
  }

  async insertTodo(
    _userId: string,
    record: ExportTodoPaper,
  ) {
    this.state.todo.push(
      structuredClone(record),
    );
    this.writes += 1;
  }

  async insertMind(
    _userId: string,
    record: ExportMindStateRecord,
  ) {
    const mind = this.state.mind ??= [];
    mind.push(structuredClone(record));
    this.writes += 1;
  }

  async insertProjectWorkspace(
    _userId: string,
    record: ExportProjectWorkspaceRecord,
  ) {
    const projects = this.state.projects ??= {
      workspaces: [],
      projects: [],
      resources: [],
      conversations: [],
    };
    projects.workspaces.push(structuredClone(record));
    this.writes += 1;
  }

  async insertProject(
    _userId: string,
    record: ExportProjectRecord,
  ) {
    const projects = this.state.projects ??= {
      workspaces: [],
      projects: [],
      resources: [],
      conversations: [],
    };
    projects.projects.push(structuredClone(record));
    this.writes += 1;
  }

  async insertProjectResource(
    _userId: string,
    record: ExportProjectResourceRecord,
  ) {
    const projects = this.state.projects ??= {
      workspaces: [],
      projects: [],
      resources: [],
      conversations: [],
    };
    projects.resources.push(structuredClone(record));
    this.writes += 1;
  }

  async insertProjectConversation(
    _userId: string,
    record: ExportProjectConversationRecord,
  ) {
    const projects = this.state.projects ??= {
      workspaces: [],
      projects: [],
      resources: [],
      conversations: [],
    };
    projects.conversations.push(structuredClone(record));
    this.writes += 1;
  }

  async rereadCreatedState(
    _userId: string,
    modules: Set<ImportModule>,
  ) {
    return {
      diary: modules.has("diary")
        ? structuredClone(this.state.diary)
        : [],
      todo: modules.has("todo")
        ? structuredClone(this.state.todo)
        : [],
      mind: modules.has("mind")
        ? structuredClone(this.state.mind ?? [])
        : undefined,
      projects: modules.has("projects")
        ? structuredClone(this.state.projects ?? {
            workspaces: [],
            projects: [],
            resources: [],
            conversations: [],
          })
        : undefined,
    };
  }

  async recordAuditRun(
    _userId: string,
    run: ImportAuditRun,
  ) {
    this.audits.push(
      structuredClone(run),
    );
  }
}

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
    id: "00000000-0000-4000-8000-000000000032",
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
  assert.deepEqual(preview.summary.projects, {
    create: 4,
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

  assert.equal(result.summary.projects?.create, 4);
  assert.deepEqual(repository.state.projects, projectBundle);
  assert.equal(repository.writes, 4);
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
      new Set([projectBundle.workspaces[0]!.id]),
    native_live_conversation_ids:
      new Set([CONVERSATION_ID]),
  });
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes(),
    USER_ID,
  );

  assert.equal(preview.summary.projects?.conflict, 1);
  assert.equal(preview.can_execute, false);
  assert.equal(repository.writes, 0);
});


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
