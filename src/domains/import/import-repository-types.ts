import type {
  createDatabase,
} from "../../database/client.js";
import type {
  ExportConversationAttachmentRecord,
  ExportConversationContentBlockRecord,
  ExportConversationMessageRecord,
  ExportConversationProviderCheckpointRecord,
  ExportConversationRecord,
  ExportDiaryCommentRecord,
  ExportDiaryRecord,
  ExportMindCuriosityResolutionEventRecord,
  ExportMindDistillationWatermarkRecord,
  ExportMindDriveSatisfactionEventRecord,
  ExportMindSemanticGroupingResultRecord,
  HistoricalMindStateRecord,
  ExportTodoPaper,
  ExportUniverseBundle,
} from "../export/export-types.js";
import type {
  ImportCurrentState,
  ImportModule,
} from "./import-planner.js";

type Database = ReturnType<typeof createDatabase>["db"];
export type Transaction =
  Parameters<Database["transaction"]>[0] extends
    (tx: infer T) => unknown
    ? T
    : never;
export type DbExecutor = Database | Transaction;

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

  insertDiaryComment(
    userId: string,
    record: ExportDiaryCommentRecord,
  ): Promise<void>;

  insertTodo(
    userId: string,
    record: ExportTodoPaper,
  ): Promise<void>;

  insertUniverse(
    userId: string,
    record: ExportUniverseBundle,
  ): Promise<void>;

  insertConversation(
    userId: string,
    record: ExportConversationRecord,
  ): Promise<void>;

  insertConversationMessage(
    userId: string,
    record: ExportConversationMessageRecord,
  ): Promise<void>;

  setConversationCurrentHead(
    userId: string,
    conversationId: string,
    currentHeadMessageId: string,
  ): Promise<void>;

  insertConversationContentBlock(
    userId: string,
    record: ExportConversationContentBlockRecord,
  ): Promise<void>;

  insertConversationAttachment(
    userId: string,
    record: ExportConversationAttachmentRecord,
  ): Promise<void>;

  insertConversationProviderCheckpoint(
    userId: string,
    record: ExportConversationProviderCheckpointRecord,
  ): Promise<void>;

  insertMind(
    userId: string,
    record: HistoricalMindStateRecord,
  ): Promise<void>;

  insertMindDriveSatisfactionEvent(
    userId: string,
    record: ExportMindDriveSatisfactionEventRecord,
  ): Promise<void>;

  insertMindCuriosityResolutionEvent(
    userId: string,
    record: ExportMindCuriosityResolutionEventRecord,
  ): Promise<void>;

  insertMindDistillationWatermark(
    userId: string,
    record: ExportMindDistillationWatermarkRecord,
  ): Promise<void>;

  insertMindSemanticGroupingResult(
    userId: string,
    record: ExportMindSemanticGroupingResultRecord,
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

