import { and, asc, eq, inArray } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversations,
  dataImportRuns,
  diaryEntries,
  projectConversations,
  projectResources,
  projects,
  projectWorkspaces,
  runtimeSubjectStates,
  todoEntries,
  todoPapers,
  users,
} from "../../database/schema.js";
import type {
  ExportDiaryRecord,
  ExportMindStateRecord,
  ExportProjectConversationRecord,
  ExportProjectRecord,
  ExportProjectResourceRecord,
  ExportProjectsBundle,
  ExportProjectWorkspaceRecord,
  ExportTodoPaper,
} from "../export/export-types.js";
import { hashCanonical } from "./import-canonical.js";
import type { ImportCurrentState, ImportModule } from "./import-planner.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction =
  Parameters<Database["transaction"]>[0] extends
    (tx: infer T) => unknown
    ? T
    : never;
type DbExecutor = Database | Transaction;

export type ImportAuditRun = {
  package_sha256: string;
  preview_fingerprint: string;
  schema_version: number;
  summary: Record<string, unknown>;
};

export interface ImportRepository {
  findUserById(
    userId: string,
  ): Promise<{ status: "active" | "disabled" } | null>;

  withTransaction<T>(
    work: (repository: ImportRepository) => Promise<T>,
  ): Promise<T>;

  readCurrentState(
    userId: string,
  ): Promise<ImportCurrentState>;

  insertDiary(
    userId: string,
    record: ExportDiaryRecord,
  ): Promise<void>;

  insertTodo(
    userId: string,
    record: ExportTodoPaper,
  ): Promise<void>;

  insertMind(
    userId: string,
    record: ExportMindStateRecord,
  ): Promise<void>;

  insertProjectWorkspace(
    userId: string,
    record: ExportProjectWorkspaceRecord,
  ): Promise<void>;

  insertProject(
    userId: string,
    record: ExportProjectRecord,
  ): Promise<void>;

  insertProjectResource(
    userId: string,
    record: ExportProjectResourceRecord,
  ): Promise<void>;

  insertProjectConversation(
    userId: string,
    record: ExportProjectConversationRecord,
  ): Promise<void>;

  rereadCreatedState(
    userId: string,
    modules: Set<ImportModule>,
  ): Promise<ImportCurrentState>;

  recordAuditRun(
    userId: string,
    run: ImportAuditRun,
  ): Promise<void>;
}

const toIso = (value: Date): string =>
  value.toISOString();

const emptyProjects = (): ExportProjectsBundle => ({
  workspaces: [],
  projects: [],
  resources: [],
  conversations: [],
});

export class DrizzleImportRepository
implements ImportRepository {
  constructor(private readonly db: DbExecutor) {}

  async findUserById(
    userId: string,
  ): Promise<{ status: "active" | "disabled" } | null> {
    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user ?? null;
  }

  async withTransaction<T>(
    work: (repository: ImportRepository) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(
      async (tx) =>
        work(
          new DrizzleImportRepository(
            tx as Transaction,
          ),
        ),
      { isolationLevel: "serializable" },
    );
  }

  async readCurrentState(
    userId: string,
  ): Promise<ImportCurrentState> {
    const [
      diary,
      papers,
      allDiary,
      workspaceRows,
      projectRows,
      resourceRows,
      conversationRows,
      mindRows,
      allWorkspaceIds,
      allProjectIds,
      allResourceIds,
      allMindIds,
      nativeLiveConversations,
    ] = await Promise.all([
      this.db
        .select()
        .from(diaryEntries)
        .where(eq(diaryEntries.userId, userId))
        .orderBy(asc(diaryEntries.id)),
      this.db
        .select()
        .from(todoPapers)
        .where(eq(todoPapers.userId, userId))
        .orderBy(
          asc(todoPapers.businessDate),
          asc(todoPapers.author),
        ),
      this.db
        .select({ id: diaryEntries.id })
        .from(diaryEntries),
      this.db
        .select({
          id: projectWorkspaces.id,
          name: projectWorkspaces.name,
          description: projectWorkspaces.description,
          version: projectWorkspaces.version,
          createdAt: projectWorkspaces.createdAt,
          updatedAt: projectWorkspaces.updatedAt,
        })
        .from(projectWorkspaces)
        .where(eq(projectWorkspaces.userId, userId))
        .orderBy(asc(projectWorkspaces.id)),
      this.db
        .select({
          id: projects.id,
          workspaceId: projects.workspaceId,
          name: projects.name,
          description: projects.description,
          version: projects.version,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
        })
        .from(projects)
        .where(eq(projects.userId, userId))
        .orderBy(asc(projects.id)),
      this.db
        .select({
          id: projectResources.id,
          projectId: projectResources.projectId,
          kind: projectResources.kind,
          key: projectResources.resourceKey,
          title: projectResources.title,
          content: projectResources.content,
          metadata: projectResources.metadata,
          version: projectResources.version,
          createdAt: projectResources.createdAt,
          updatedAt: projectResources.updatedAt,
        })
        .from(projectResources)
        .where(eq(projectResources.userId, userId))
        .orderBy(asc(projectResources.id)),
      this.db
        .select({
          projectId: projectConversations.projectId,
          conversationId: projectConversations.conversationId,
          addedAt: projectConversations.addedAt,
        })
        .from(projectConversations)
        .where(eq(projectConversations.userId, userId))
        .orderBy(
          asc(projectConversations.projectId),
          asc(projectConversations.conversationId),
        ),
      this.db
        .select({
          id: runtimeSubjectStates.id,
          subjectId: runtimeSubjectStates.subjectId,
          kind: runtimeSubjectStates.kind,
          text: runtimeSubjectStates.text,
          payload: runtimeSubjectStates.payload,
          scopeApplicability: runtimeSubjectStates.scopeApplicability,
          scopeConversationId: runtimeSubjectStates.scopeConversationId,
          scopePathHeadMessageId: runtimeSubjectStates.scopePathHeadMessageId,
          settlementStatus: runtimeSubjectStates.settlementStatus,
          pathStatus: runtimeSubjectStates.pathStatus,
          validityStatus: runtimeSubjectStates.validityStatus,
          envelope: runtimeSubjectStates.envelope,
          createdAt: runtimeSubjectStates.createdAt,
          updatedAt: runtimeSubjectStates.updatedAt,
        })
        .from(runtimeSubjectStates)
        .where(eq(runtimeSubjectStates.userId, userId))
        .orderBy(asc(runtimeSubjectStates.id)),
      this.db
        .select({ id: projectWorkspaces.id })
        .from(projectWorkspaces),
      this.db
        .select({ id: projects.id })
        .from(projects),
      this.db
        .select({ id: projectResources.id })
        .from(projectResources),
      this.db
        .select({ id: runtimeSubjectStates.id })
        .from(runtimeSubjectStates),
      this.db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(
          eq(conversations.userId, userId),
          eq(conversations.origin, "native_live"),
        )),
    ]);

    const entries =
      papers.length === 0
        ? []
        : await this.db
            .select({
              paperId: todoEntries.paperId,
              id: todoEntries.entryId,
              kind: todoEntries.kind,
              text: todoEntries.text,
            })
            .from(todoEntries)
            .where(
              inArray(
                todoEntries.paperId,
                papers.map((paper) => paper.id),
              ),
            )
            .orderBy(
              asc(todoEntries.paperId),
              asc(todoEntries.position),
            );

    const grouped = new Map<
      string,
      Array<{
        id: string;
        kind: "pending" | "completed" | "record";
        text: string;
      }>
    >();

    for (const entry of entries) {
      const list = grouped.get(entry.paperId) ?? [];
      list.push({
        id: entry.id,
        kind: entry.kind,
        text: entry.text,
      });
      grouped.set(entry.paperId, list);
    }

    return {
      diary: diary.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        date: row.date,
        tags: row.tags,
        mood: row.mood,
        source: row.source,
        author: row.author,
        status: row.status,
        created_at: toIso(row.createdAt),
        updated_at: toIso(row.updatedAt),
      })),
      todo: papers.map((row) => ({
        date: row.businessDate,
        author: row.author,
        revision: row.revision,
        created_at: toIso(row.createdAt),
        updated_at: toIso(row.updatedAt),
        entries: grouped.get(row.id) ?? [],
      })),
      mind: mindRows.map((row) => ({
        id: row.id,
        subject_id: row.subjectId,
        kind: row.kind,
        text: row.text,
        payload: row.payload,
        scope_applicability: row.scopeApplicability,
        scope_conversation_id: row.scopeConversationId,
        scope_path_head_message_id: row.scopePathHeadMessageId,
        settlement_status: row.settlementStatus,
        path_status: row.pathStatus,
        validity_status: row.validityStatus,
        envelope: row.envelope,
        created_at: toIso(row.createdAt),
        updated_at: toIso(row.updatedAt),
      })),
      projects: {
        workspaces: workspaceRows.map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          version: row.version,
          created_at: toIso(row.createdAt),
          updated_at: toIso(row.updatedAt),
        })),
        projects: projectRows.map((row) => ({
          id: row.id,
          workspace_id: row.workspaceId,
          name: row.name,
          description: row.description,
          version: row.version,
          created_at: toIso(row.createdAt),
          updated_at: toIso(row.updatedAt),
        })),
        resources: resourceRows.map((row) => ({
          id: row.id,
          project_id: row.projectId,
          kind: row.kind,
          key: row.key,
          title: row.title,
          content: row.content,
          metadata: row.metadata,
          version: row.version,
          created_at: toIso(row.createdAt),
          updated_at: toIso(row.updatedAt),
        })),
        conversations: conversationRows.map((row) => ({
          project_id: row.projectId,
          conversation_id: row.conversationId,
          added_at: toIso(row.addedAt),
        })),
      },
      foreign_diary_ids: new Set(
        allDiary
          .filter((row) => !diary.some((owned) => owned.id === row.id))
          .map((row) => row.id),
      ),
      foreign_workspace_ids: new Set(
        allWorkspaceIds
          .filter((row) => !workspaceRows.some((owned) => owned.id === row.id))
          .map((row) => row.id),
      ),
      foreign_project_ids: new Set(
        allProjectIds
          .filter((row) => !projectRows.some((owned) => owned.id === row.id))
          .map((row) => row.id),
      ),
      foreign_project_resource_ids: new Set(
        allResourceIds
          .filter((row) => !resourceRows.some((owned) => owned.id === row.id))
          .map((row) => row.id),
      ),
      foreign_mind_ids: new Set(
        allMindIds
          .filter((row) => !mindRows.some((owned) => owned.id === row.id))
          .map((row) => row.id),
      ),
      native_live_conversation_ids: new Set(
        nativeLiveConversations.map((row) => row.id),
      ),
    };
  }

  async insertDiary(
    userId: string,
    record: ExportDiaryRecord,
  ): Promise<void> {
    const values = {
      id: record.id,
      userId,
      title: record.title,
      content: record.content,
      date: record.date,
      tags: record.tags,
      mood: record.mood,
      source: record.source as "chatgpt_mcp",
      author: record.author,
      status: record.status,
      idempotencyKey: `import:${record.id}`,
      requestHash: hashCanonical(record),
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    } as unknown as typeof diaryEntries.$inferInsert;

    await this.db.insert(diaryEntries).values(values);
  }

  async insertTodo(
    userId: string,
    record: ExportTodoPaper,
  ): Promise<void> {
    const [paper] = await this.db
      .insert(todoPapers)
      .values({
        userId,
        businessDate: record.date,
        author: record.author,
        revision: record.revision,
        createdAt: new Date(record.created_at),
        updatedAt: new Date(record.updated_at),
      })
      .returning({ id: todoPapers.id });

    if (!paper) {
      throw new Error("todo paper insert failed");
    }

    if (record.entries.length > 0) {
      await this.db.insert(todoEntries).values(
        record.entries.map((entry, position) => ({
          paperId: paper.id,
          entryId: entry.id,
          kind: entry.kind,
          text: entry.text,
          position,
        })),
      );
    }
  }

  async insertMind(
    userId: string,
    record: ExportMindStateRecord,
  ): Promise<void> {
    await this.db.insert(runtimeSubjectStates).values({
      id: record.id,
      userId,
      subjectId: record.subject_id,
      kind: record.kind,
      text: record.text,
      payload: record.payload,
      scopeApplicability: record.scope_applicability,
      scopeConversationId: record.scope_conversation_id,
      scopePathHeadMessageId: record.scope_path_head_message_id,
      settlementStatus: record.settlement_status,
      pathStatus: record.path_status,
      validityStatus: record.validity_status,
      envelope: record.envelope,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    });
  }

  async insertProjectWorkspace(
    userId: string,
    record: ExportProjectWorkspaceRecord,
  ): Promise<void> {
    await this.db.insert(projectWorkspaces).values({
      id: record.id,
      userId,
      name: record.name,
      description: record.description,
      version: record.version,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    });
  }

  async insertProject(
    userId: string,
    record: ExportProjectRecord,
  ): Promise<void> {
    await this.db.insert(projects).values({
      id: record.id,
      userId,
      workspaceId: record.workspace_id,
      name: record.name,
      description: record.description,
      version: record.version,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    });
  }

  async insertProjectResource(
    userId: string,
    record: ExportProjectResourceRecord,
  ): Promise<void> {
    await this.db.insert(projectResources).values({
      id: record.id,
      userId,
      projectId: record.project_id,
      kind: record.kind,
      resourceKey: record.key,
      title: record.title,
      content: record.content,
      metadata: record.metadata,
      version: record.version,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    });
  }

  async insertProjectConversation(
    userId: string,
    record: ExportProjectConversationRecord,
  ): Promise<void> {
    await this.db.insert(projectConversations).values({
      userId,
      projectId: record.project_id,
      conversationId: record.conversation_id,
      addedAt: new Date(record.added_at),
    });
  }

  async rereadCreatedState(
    userId: string,
    modules: Set<ImportModule>,
  ): Promise<ImportCurrentState> {
    const state = await this.readCurrentState(userId);
    return {
      diary: modules.has("diary")
        ? state.diary
        : [],
      todo: modules.has("todo")
        ? state.todo
        : [],
      mind: modules.has("mind")
        ? state.mind
        : undefined,
      projects: modules.has("projects")
        ? state.projects
        : emptyProjects(),
    };
  }

  async recordAuditRun(
    userId: string,
    run: ImportAuditRun,
  ): Promise<void> {
    await this.db.insert(dataImportRuns).values({
      userId,
      packageSha256: run.package_sha256,
      previewFingerprint:
        run.preview_fingerprint,
      schemaVersion: run.schema_version,
      summary: run.summary,
    });
  }
}
