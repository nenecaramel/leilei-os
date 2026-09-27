import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerFingerprint } from "../src/domains/export/owner-fingerprint.js";
import type {
  ExportDiaryRecord,
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

function cloneState(
  state: ImportCurrentState,
): ImportCurrentState {
  return {
    diary: structuredClone(state.diary),
    todo: structuredClone(state.todo),
    projects: state.projects
      ? structuredClone(state.projects)
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
