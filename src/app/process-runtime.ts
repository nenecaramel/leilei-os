import { env, getMcpGovernanceConfig, type RuntimeEnv } from "../config/env.js";
import { createDatabase } from "../database/client.js";
import type { AppDependencies } from "./create-app.js";
import { DrizzleMemoryRepository } from "../domains/memory/memory-repository.js";
import { MemoryService } from "../domains/memory/memory-service.js";
import { DrizzleDiaryRepository } from "../domains/diary/diary-repository.js";
import { DiaryService } from "../domains/diary/diary-service.js";
import { DrizzleTaskRepository } from "../domains/task/task-repository.js";
import { TaskService } from "../domains/task/task-service.js";
import { DrizzleToyCommandRepository } from "../domains/toy/toy-command-repository.js";
import { ToyCommandService } from "../domains/toy/toy-command-service.js";
import { DrizzleGlobalSearchRepository } from "../domains/global-search/global-search-repository.js";
import { GlobalSearchService } from "../domains/global-search/global-search-service.js";
import { DrizzleSystemRepository } from "../domains/system/system-repository.js";
import { SystemService } from "../domains/system/system-service.js";
import { DrizzleTodoRepository } from "../domains/todo/todo-repository.js";
import { TodoService } from "../domains/todo/todo-service.js";
import { DrizzleExportRepository } from "../domains/export/export-repository.js";
import { ExportService } from "../domains/export/export-service.js";
import { DrizzleImportRepository } from "../domains/import/import-repository.js";
import { ImportService } from "../domains/import/import-service.js";
import { DrizzleUniverseRepository } from "../domains/universe/universe-repository-drizzle.js";
import { UniverseService } from "../domains/universe/universe-service.js";
import { DrizzleBridgeEventRepository } from "../domains/bridge/bridge-event-repository.js";
import { BridgeService } from "../domains/bridge/bridge-service.js";
import { BRIDGE_TERMINAL_RETENTION_DAYS, deleteExpiredBridgeEventsBatch } from "../domains/bridge/bridge-retention.js";
import {
  deleteExpiredMcpIdempotencyBatch,
} from "../mcp/server/idempotency-retention.js";
import { deleteExpiredDataImportRunsBatch } from "../domains/import/import-retention.js";
import { createRetentionCoordinator } from "../domains/retention/retention-coordinator.js";
import { DATA_IMPORT_RETENTION_DAYS } from "../domains/retention/retention-policy.js";
import { McpSessionRegistry } from "../mcp/server/session-registry.js";
import { createProductionMcpSessionServerFactory } from "../mcp/server/production-server-factory.js";
import { createSafeLogger, type SafeLogger } from "../observability/logger.js";
import {
  createMcpLifecycleObserver,
  createBridgeObserver,
  createRetentionObserver,
} from "../observability/runtime-observers.js";

type DatabaseResource = ReturnType<typeof createDatabase>;

export type ProcessRuntime = {
  appDependencies: AppDependencies;
  mcpSessionRegistry: McpSessionRegistry;
  logger: SafeLogger;
  startBackgroundWork(): void;
  stopBackgroundWork(): void;
  drainBackgroundWork(): Promise<void>;
  closeDatabase(): Promise<void>;
};

export type ProcessRuntimeFactoryDependencies = {
  environment?: RuntimeEnv;
  createDatabaseResource?: (databaseUrl: string) => DatabaseResource;
  createLogger?: (level: RuntimeEnv["LOG_LEVEL"]) => SafeLogger;
};

export function createProcessRuntime(
  options: ProcessRuntimeFactoryDependencies = {},
): ProcessRuntime {
  const runtimeEnv = options.environment ?? env;
  if (!runtimeEnv.DATABASE_URL) {
    throw new Error("Database is not configured.");
  }

  const logger =
    (options.createLogger ?? ((level) => createSafeLogger({ level })))(runtimeEnv.LOG_LEVEL);
  const observeLifecycle = createMcpLifecycleObserver(logger);
  const database = (options.createDatabaseResource ?? createDatabase)(runtimeEnv.DATABASE_URL);
  const { db } = database;
  const memoryRepository = new DrizzleMemoryRepository(db);
  const memoryService = new MemoryService(memoryRepository);
  const diaryService = new DiaryService(new DrizzleDiaryRepository(db));
  const taskService = new TaskService(new DrizzleTaskRepository(db));
  const toyCommandService = new ToyCommandService(
    new DrizzleToyCommandRepository(db),
    runtimeEnv.LEILEI_TOY_BRIDGE_USER_ID,
  );
  const globalSearchService = new GlobalSearchService(new DrizzleGlobalSearchRepository(db));
  const systemService = new SystemService(new DrizzleSystemRepository(db), {
    internalMcpEnabled: Boolean(runtimeEnv.MCP_AUTH_TOKEN),
  });
  const todoService = new TodoService(new DrizzleTodoRepository(db));
  const exportService = new ExportService(new DrizzleExportRepository(db));
  const importService = new ImportService(new DrizzleImportRepository(db));
  const universeService = new UniverseService(new DrizzleUniverseRepository(db));
  const bridgeService = new BridgeService(new DrizzleBridgeEventRepository(db), { observe: createBridgeObserver(logger) });

  const governance = getMcpGovernanceConfig(runtimeEnv);
  const mcpSessionRegistry = new McpSessionRegistry({
    idleTtlMs: governance.idleTtlSeconds * 1_000,
    absoluteTtlMs: governance.absoluteTtlSeconds * 1_000,
    maxPerUser: governance.maxPerUser,
    maxTotal: governance.maxTotal,
    observer: observeLifecycle,
  });
  const retentionCoordinator = createRetentionCoordinator({
    intervalMs: governance.idempotencyCleanupIntervalHours * 60 * 60 * 1_000,
    policies: [
      {
        policy: "mcp_write_idempotency",
        retentionMs: governance.idempotencyRetentionDays * 24 * 60 * 60 * 1_000,
        deleteBatch: (cutoff, limit) => deleteExpiredMcpIdempotencyBatch(db, cutoff, limit),
      },
      {
        policy: "data_import_runs",
        retentionMs: DATA_IMPORT_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
        deleteBatch: (cutoff, limit) => deleteExpiredDataImportRunsBatch(db, cutoff, limit),
      },
      {
        policy: "bridge_events",
        retentionMs: BRIDGE_TERMINAL_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
        deleteBatch: (cutoff, limit) => deleteExpiredBridgeEventsBatch(db, cutoff, limit),
      },
    ],
    observe: createRetentionObserver(logger),
  });
  const createMcpSessionServer = createProductionMcpSessionServerFactory({
    activeUserRepository: memoryRepository,
    memoryService,
    diaryService,
    taskService,
    toyCommandService,
    globalSearchService,
    todoService,
    universeService,
    bridgeService,
    logger,
  });

  return {
    mcpSessionRegistry,
    logger,
    appDependencies: {
      logger,
      webMemoryService: memoryService,
      webDiaryService: diaryService,
      webTaskService: taskService,
      webSystemService: systemService,
      toyService: toyCommandService,
      webGlobalSearchService: globalSearchService,
      webTodoService: todoService,
      webExportService: exportService,
      webImportService: importService,
      webUniverseService: universeService,
      webBridgeService: bridgeService,
      databaseReadinessProbe: database.probe,
      mcpSessionRegistry,
      createMcpSessionServer,
    },
    startBackgroundWork: () => retentionCoordinator.start(),
    stopBackgroundWork: () => retentionCoordinator.stopScheduling(),
    drainBackgroundWork: () => retentionCoordinator.drain(),
    closeDatabase: database.close,
  };
}
