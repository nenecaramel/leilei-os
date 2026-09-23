import {
  env,
  getMcpGovernanceConfig,
  getTopicResurfaceOpportunityConfig,
  type RuntimeEnv,
} from "../config/env.js";
import { createDatabase } from "../database/client.js";
import type { AppDependencies } from "./create-app.js";
import { DrizzleMemoryRepository } from "../domains/memory/memory-repository.js";
import { MemoryService } from "../domains/memory/memory-service.js";
import { DrizzleDiaryRepository } from "../domains/diary/diary-repository.js";
import { DiaryService } from "../domains/diary/diary-service.js";
import { DrizzleDiaryCommentRepository } from "../domains/diary/diary-comment-repository.js";
import { DiaryCommentService } from "../domains/diary/diary-comment-service.js";
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
import {
  createDefaultBackendMindRuntime,
  createDefaultDriveSatisfactionService,
  DEFAULT_NATIVE_LIVE_SUBJECT_ID,
} from "../domains/runtime/default-backend-mind-runtime.js";
import {
  deleteExpiredNativeLiveBackgroundModelJobsBatch,
  DrizzleNativeLiveBackgroundModelQueueRepository,
  NativeLiveBackgroundModelQueueService,
} from "../domains/bridge/native-live-background-model-queue.js";
import {
  TopicResurfaceCrossDeviceCoordinator,
} from "../domains/runtime/topic-resurface-cross-device-coordinator.js";
import {
  TopicResurfaceCrossDeviceOpportunity,
} from "../domains/runtime/topic-resurface-cross-device-opportunity.js";
import {
  DrizzleTopicResurfaceCandidatePort,
} from "../domains/runtime/topic-resurface-candidate-runtime-repository.js";
import {
  TopicResurfaceCandidateService,
} from "../domains/runtime/topic-resurface-candidates.js";
import {
  DrizzleTopicResurfaceThoughtMaterializationPort,
} from "../domains/runtime/topic-resurface-thought-materialization-runtime-repository.js";
import type {
  DriveSatisfactionService,
} from "../domains/runtime/drive-satisfaction-runtime-repository.js";
import { DrizzleNativeLiveBackendTurnPort } from "../domains/bridge/native-live-backend-turn-repository.js";
import { NativeLiveBackendTurnCoordinator } from "../domains/bridge/native-live-backend-turn-coordinator.js";
import { NativeLiveBackendRelayPrepareCoordinator } from "../domains/bridge/native-live-backend-relay-prepare.js";
import {
  DrizzleNativeLiveBackendRelayRepository,
  NativeLiveBackendRelayService,
} from "../domains/bridge/native-live-backend-relay.js";
import {
  DrizzleNativeLiveMindFollowUpRepository,
  NativeLiveMindFollowUpService,
  createNativeLiveMindFollowUpScheduler,
} from "../domains/bridge/native-live-mind-followup.js";
import {
  DrizzleNativeLiveSemanticScoringRepository,
  NativeLiveSemanticHandshakeService,
  createNativeLiveSemanticCompletionScheduler,
} from "../domains/bridge/native-live-semantic-handshake.js";
import { BRIDGE_TERMINAL_RETENTION_DAYS, deleteExpiredBridgeEventsBatch } from "../domains/bridge/bridge-retention.js";
import {
  deleteExpiredMcpIdempotencyBatch,
} from "../mcp/server/idempotency-retention.js";
import { deleteExpiredDataImportRunsBatch } from "../domains/import/import-retention.js";
import { createRetentionCoordinator } from "../domains/retention/retention-coordinator.js";
import {
  DATA_IMPORT_RETENTION_DAYS,
  NATIVE_LIVE_BACKGROUND_MODEL_RETENTION_DAYS,
} from "../domains/retention/retention-policy.js";
import { DrizzleSentinelRepository } from "../domains/sentinel/sentinel-repository.js";
import { SentinelService } from "../domains/sentinel/sentinel-service.js";
import { DrizzleHealthRepository } from "../domains/health-v2/health-repository.js";
import { HealthService } from "../domains/health-v2/health-service.js";
import { DrizzleSharedPaperRepository } from "../domains/shared-paper/shared-paper-repository.js";
import { SharedPaperService } from "../domains/shared-paper/shared-paper-service.js";
import { DrizzleConversationImportRepository } from "../domains/conversation/conversation-import-repository.js";
import { DrizzleConversationArchiveStateRepository } from "../domains/conversation/conversation-state-repository.js";
import { ConversationImportService } from "../domains/conversation/conversation-import-service.js";
import { DrizzleConversationImportExecutor } from "../domains/conversation/conversation-import-executor.js";
import { DrizzleConversationArchiveReadRepository } from "../domains/conversation/conversation-archive-read-repository.js";
import { ConversationArchiveReadService } from "../domains/conversation/conversation-archive-read-service.js";
import { DrizzleConversationPruningRepository } from "../domains/conversation/conversation-pruning-repository.js";
import { ConversationPruningService } from "../domains/conversation/conversation-pruning-service.js";
import { DrizzleConversationFavoriteRepository } from "../domains/conversation/conversation-favorite-repository.js";
import { ConversationFavoriteService } from "../domains/conversation/conversation-favorite-service.js";
import { DrizzleConversationExclusionManagementRepository } from "../domains/conversation/conversation-exclusion-management-repository.js";
import { ConversationExclusionManagementService } from "../domains/conversation/conversation-exclusion-management-service.js";
import { DrizzleConversationImportHistoryRepository } from "../domains/conversation/conversation-import-history-repository.js";
import { ConversationImportHistoryService } from "../domains/conversation/conversation-import-history-service.js";
import {
  createSentinelScheduler as buildSentinelScheduler,
  type SentinelScheduler,
  type SentinelSchedulerRepository,
} from "../domains/sentinel/sentinel-scheduler.js";
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
  driveSatisfactionService: DriveSatisfactionService;
  topicResurfaceCrossDeviceCoordinator:
    TopicResurfaceCrossDeviceCoordinator;
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
  createSentinelScheduler?: (
    repository: SentinelSchedulerRepository,
  ) => SentinelScheduler;
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
  const diaryCommentService = new DiaryCommentService(
    new DrizzleDiaryCommentRepository(db),
  );
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
  const nativeLiveBackendMind = createDefaultBackendMindRuntime(db);
  const driveSatisfactionService =
    createDefaultDriveSatisfactionService(db);
  const nativeLiveTurnPort = new DrizzleNativeLiveBackendTurnPort(db);
  const nativeLiveMindFollowUpService = new NativeLiveMindFollowUpService(
    new DrizzleNativeLiveMindFollowUpRepository(db),
    nativeLiveTurnPort,
    nativeLiveBackendMind,
  );
  const nativeLiveMindFollowUpScheduler =
    createNativeLiveMindFollowUpScheduler({
      service: nativeLiveMindFollowUpService,
    });
  const nativeLiveTurnCoordinator = new NativeLiveBackendTurnCoordinator(
    nativeLiveTurnPort,
    undefined,
    nativeLiveBackendMind,
    nativeLiveMindFollowUpService,
  );
  const nativeLiveRelayService = new NativeLiveBackendRelayService(
    new DrizzleNativeLiveBackendRelayRepository(db),
    nativeLiveTurnCoordinator,
  );
  const nativeLiveBackgroundModelService =
    new NativeLiveBackgroundModelQueueService(
      new DrizzleNativeLiveBackgroundModelQueueRepository(db),
    );
  const topicResurfaceCrossDeviceCoordinator =
    new TopicResurfaceCrossDeviceCoordinator(
      nativeLiveBackgroundModelService,
      new TopicResurfaceCandidateService(
        new DrizzleTopicResurfaceCandidatePort(db),
      ),
      new DrizzleTopicResurfaceThoughtMaterializationPort(db),
      {
        ruleVersion: "topic-resurface-thought-v1",
        processVersion: "topic-resurface-thought-materialization-v1",
        deliberationPromptContractVersion:
          "topic-resurface-deliberation-v1",
        retentionPromptContractVersion:
          "topic-resurface-retention-v1",
        model: {
          provider: "claude_code",
          model: "runtime-selected",
          configVersion: "cross-device-v1",
          promptContractVersion: "topic-resurface-v1",
        },
      },
    );
  const topicResurfaceOpportunityConfig =
    getTopicResurfaceOpportunityConfig(runtimeEnv);
  const topicResurfaceCrossDeviceOpportunity =
    topicResurfaceOpportunityConfig
      ? new TopicResurfaceCrossDeviceOpportunity(
          topicResurfaceCrossDeviceCoordinator,
          DEFAULT_NATIVE_LIVE_SUBJECT_ID,
          topicResurfaceOpportunityConfig,
        )
      : undefined;
  const nativeLiveSemanticService = new NativeLiveSemanticHandshakeService(
    new DrizzleNativeLiveSemanticScoringRepository(db),
    nativeLiveTurnPort,
    nativeLiveBackendMind,
    nativeLiveRelayService,
  );
  const nativeLiveSemanticScheduler =
    createNativeLiveSemanticCompletionScheduler({
      service: nativeLiveSemanticService,
    });
  const nativeLiveRelayPrepareCoordinator =
    new NativeLiveBackendRelayPrepareCoordinator(
      nativeLiveTurnPort,
      nativeLiveBackendMind,
      nativeLiveSemanticService,
    );
  const sentinelRepository = new DrizzleSentinelRepository(db);
  const sentinelService = new SentinelService(sentinelRepository);
  const healthService = new HealthService(new DrizzleHealthRepository(db));
  const sharedPaperService = new SharedPaperService(new DrizzleSharedPaperRepository(db));
  const conversationImportService = new ConversationImportService(
    new DrizzleConversationImportRepository(db),
    new DrizzleConversationArchiveStateRepository(db),
    new DrizzleConversationImportExecutor(db),
  );
  const conversationArchiveReadService = new ConversationArchiveReadService(
    new DrizzleConversationArchiveReadRepository(db),
  );
  const conversationPruningService = new ConversationPruningService(
    new DrizzleConversationPruningRepository(db),
  );
  const conversationFavoriteService = new ConversationFavoriteService(
    new DrizzleConversationFavoriteRepository(db),
  );
  const conversationExclusionManagementService = new ConversationExclusionManagementService(
    new DrizzleConversationExclusionManagementRepository(db),
    conversationImportService,
  );
  const conversationImportHistoryService = new ConversationImportHistoryService(
    new DrizzleConversationImportHistoryRepository(db),
  );
  const sentinelScheduler = (options.createSentinelScheduler ?? ((repository) =>
    buildSentinelScheduler({ repository })))(sentinelRepository);

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
      {
        policy: "native_live_background_model_jobs",
        retentionMs:
          NATIVE_LIVE_BACKGROUND_MODEL_RETENTION_DAYS
          * 24 * 60 * 60 * 1_000,
        deleteBatch: (cutoff, limit) =>
          deleteExpiredNativeLiveBackgroundModelJobsBatch(
            db,
            cutoff,
            limit,
          ),
      },
    ],
    observe: createRetentionObserver(logger),
  });
  const createMcpSessionServer = createProductionMcpSessionServerFactory({
    activeUserRepository: memoryRepository,
    memoryService,
    diaryService,
    diaryCommentService,
    taskService,
    toyCommandService,
    globalSearchService,
    conversationArchiveReadService,
    conversationPruningService,
    conversationExclusionManagementService,
    todoService,
    universeService,
    healthService,
    sharedPaperService,
    sentinelService,
    bridgeService,
    bridgeAmbiguityAcceptanceEnabled: runtimeEnv.BRIDGE_AMBIGUITY_ACCEPTANCE_ENABLED,
    logger,
  });

  return {
    mcpSessionRegistry,
    logger,
    driveSatisfactionService,
    topicResurfaceCrossDeviceCoordinator,
    appDependencies: {
      logger,
      webMemoryService: memoryService,
      webDiaryService: diaryService,
      webDiaryCommentService: diaryCommentService,
      webTaskService: taskService,
      webSystemService: systemService,
      toyService: toyCommandService,
      webGlobalSearchService: globalSearchService,
      webTodoService: todoService,
      webExportService: exportService,
      webImportService: importService,
      webUniverseService: universeService,
      webBridgeService: bridgeService,
      webNativeLiveCoordinator: nativeLiveRelayPrepareCoordinator,
      webNativeLiveTurnReader: nativeLiveTurnPort,
      nativeLiveRelayService,
      nativeLiveSemanticService,
      nativeLiveBackgroundModelService,
      nativeLiveBackgroundModelCoordinator:
        topicResurfaceCrossDeviceCoordinator,
      ...(topicResurfaceCrossDeviceOpportunity
        ? {
            nativeLiveBackgroundModelOpportunity:
              topicResurfaceCrossDeviceOpportunity,
          }
        : {}),
      webSentinelService: sentinelService,
      webSharedPaperService: sharedPaperService,
      webConversationImportService: conversationImportService,
      webConversationArchiveReadService: conversationArchiveReadService,
      webConversationPruningService: conversationPruningService,
      webConversationLifecycle: {
        conversationPruningService,
        conversationArchiveReadService,
      },
      webConversationFavoriteService: conversationFavoriteService,
      webConversationExclusionManagementService: conversationExclusionManagementService,
      webConversationImportHistoryService: conversationImportHistoryService,
      healthSyncService: healthService,
      databaseReadinessProbe: database.probe,
      mcpSessionRegistry,
      createMcpSessionServer,
    },
    startBackgroundWork: () => {
      retentionCoordinator.start();
      sentinelScheduler.start();
      nativeLiveMindFollowUpScheduler.start();
      nativeLiveSemanticScheduler.start();
    },
    stopBackgroundWork: () => {
      retentionCoordinator.stopScheduling();
      sentinelScheduler.stopScheduling();
      nativeLiveMindFollowUpScheduler.stopScheduling();
      nativeLiveSemanticScheduler.stopScheduling();
    },
    drainBackgroundWork: async () => {
      await Promise.all([
        retentionCoordinator.drain(),
        sentinelScheduler.drain(),
        nativeLiveMindFollowUpScheduler.drain(),
        nativeLiveSemanticScheduler.drain(),
      ]);
    },
    closeDatabase: database.close,
  };
}
