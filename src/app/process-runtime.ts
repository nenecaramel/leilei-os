import { randomUUID } from "node:crypto";
import {
  env,
  getMcpGovernanceConfig,
  getMemoryDecayConfig,
  getProactivityWakeOpportunityConfig,
  getTopicResurfaceOpportunityConfig,
  type RuntimeEnv,
} from "../config/env.js";
import { createDatabase } from "../database/client.js";
import type { AppDependencies } from "./create-app.js";
import { DrizzleDiaryRepository } from "../domains/diary/diary-repository.js";
import { DiaryService } from "../domains/diary/diary-service.js";
import { DrizzleDiaryCommentRepository } from "../domains/diary/diary-comment-repository.js";
import { DiaryCommentService } from "../domains/diary/diary-comment-service.js";
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
  createDefaultSubjectStateBackgroundMaintenance,
  DEFAULT_NATIVE_LIVE_SUBJECT_ID,
  DEFAULT_NATIVE_LIVE_SURFACE_LIMIT,
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
import {
  BackgroundLoopOrchestrator,
} from "../domains/runtime/background-loop-orchestrator.js";
import {
  CompanionBackgroundOpportunityService,
} from "../domains/runtime/companion-background-opportunity.js";
import {
  BackgroundOpportunityPolicy,
  DEFAULT_BACKGROUND_TARGET_PLANS,
} from "../domains/runtime/background-opportunity-policy.js";
import {
  DistillationCrossDeviceCoordinator,
} from "../domains/runtime/distillation-cross-device-coordinator.js";
import {
  DistillationCrossDeviceBackgroundTrigger,
} from "../domains/runtime/distillation-cross-device-background-trigger.js";
import {
  DrizzleDistillationRuntimePort,
} from "../domains/runtime/distillation-runtime-repository.js";
import {
  CLAUDE_CODE_DISTILLATION_PROMPT_CONTRACT_VERSION,
} from "../domains/runtime/claude-code-distillation-model.js";
import {
  NativeLiveBackgroundWorkflowCoordinator,
  type NativeLiveBackgroundWorkflowAdvancer,
} from "../domains/bridge/native-live-background-workflow-coordinator.js";
import {
  ProactivityWakeCrossDeviceCoordinator,
} from "../domains/runtime/proactivity-wake-cross-device-coordinator.js";
import {
  DrizzleProactivityWakeRepository,
} from "../domains/runtime/proactivity-wake-repository.js";
import {
  DrizzleRuntimeEffectRepository,
} from "../domains/runtime/runtime-effect-repository.js";
import {
  ProactivityEffectMaterializer,
} from "../domains/runtime/proactivity-effect-materializer.js";
import {
  DrizzleRuntimeEffectForegroundGuard,
  RuntimeEffectDeliveryCoordinator,
} from "../domains/runtime/runtime-effect-delivery-coordinator.js";
import {
  RuntimeMessageEffectDeliveryAdapter,
} from "../domains/runtime/runtime-message-effect-delivery-adapter.js";
import {
  RuntimeEffectDeliveryWorker,
} from "../domains/runtime/runtime-effect-delivery-worker.js";
import {
  DrizzleProactivityWakeOpportunitySource,
  ProactivityWakeOpportunityProducer,
} from "../domains/runtime/proactivity-wake-opportunity.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../domains/conversation/native-live-conversation-repository.js";
import {
  NativeLiveConversationService,
} from "../domains/conversation/native-live-conversation-service.js";
import {
  DrizzleNativeLiveCurrentPathReader,
} from "../domains/conversation/native-live-current-path-read-repository.js";
import { DrizzleNativeLiveBackendTurnPort } from "../domains/bridge/native-live-backend-turn-repository.js";
import { NativeLiveBackendTurnCoordinator } from "../domains/bridge/native-live-backend-turn-coordinator.js";
import { NativeLiveBackendRelayPrepareCoordinator } from "../domains/bridge/native-live-backend-relay-prepare.js";
import {
  DrizzleNativeLiveBackendRelayRepository,
  NativeLiveBackendRelayService,
} from "../domains/bridge/native-live-backend-relay.js";
import {
  DrizzleNativeLiveWorkAvailability,
  DrizzleNativeLiveWorkWakePublisher,
  NativeLiveWorkWakeBroker,
  NativeLiveWorkWaitService,
} from "../domains/bridge/native-live-work-wake.js";
import {
  NativeLiveTurnWaitService,
} from "../domains/bridge/native-live-turn-wait.js";
import {
  DrizzleNativeLiveRuntimeEventRepository,
  NativeLiveRuntimeEventService,
} from "../domains/bridge/native-live-runtime-event-stream.js";
import {
  DrizzleNativeLiveRuntimeInteractionRepository,
  NativeLiveRuntimeInteractionService,
} from "../domains/bridge/native-live-runtime-interaction.js";
import {
  DrizzleNativeLiveRuntimeControlRepository,
  NativeLiveRuntimeControlService,
} from "../domains/bridge/native-live-runtime-control.js";
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
  deleteExpiredRuntimeOperationalRecordsBatch,
  RUNTIME_OPERATIONAL_RETENTION_DAYS,
} from "../domains/retention/runtime-operational-retention.js";
import {
  DATA_IMPORT_RETENTION_DAYS,
  NATIVE_LIVE_BACKGROUND_MODEL_RETENTION_DAYS,
} from "../domains/retention/retention-policy.js";
import { DrizzleSentinelRepository } from "../domains/sentinel/sentinel-repository.js";
import { SentinelService } from "../domains/sentinel/sentinel-service.js";
import { DrizzleHealthRepository } from "../domains/health-v2/health-repository.js";
import { HealthService } from "../domains/health-v2/health-service.js";
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
import {
  DEFAULT_INTERNAL_MCP_TOOL_PROFILES,
  DEFAULT_PUBLIC_MCP_TOOL_PROFILES,
  parseMcpToolProfiles,
} from "../mcp/server/tool-profiles.js";
import { createSafeLogger, type SafeLogger } from "../observability/logger.js";
import {
  createMcpLifecycleObserver,
  createBridgeObserver,
  createRetentionObserver,
} from "../observability/runtime-observers.js";

type DatabaseResource = ReturnType<typeof createDatabase>;

type BackgroundWorkflowKind =
  | "distillation"
  | "proactivity_wake"
  | "topic_resurface";

function observeBackgroundWorkflowAdvancer(
  workflowKind: BackgroundWorkflowKind,
  advancer: NativeLiveBackgroundWorkflowAdvancer,
  logger: SafeLogger,
): NativeLiveBackgroundWorkflowAdvancer {
  return {
    async advanceNextForUser(input) {
      try {
        const result = await advancer.advanceNextForUser(input);
        const outcome =
          result
          && typeof result === "object"
          && "outcome" in result
          && typeof (result as { outcome?: unknown }).outcome === "string"
            ? (result as { outcome: string }).outcome
            : "unknown";
        logger.info("native_live_background_workflow_advance", {
          workflowKind,
          outcome,
        });
        return result;
      } catch (error) {
        logger.warn("native_live_background_workflow_advance_failed", {
          workflowKind,
          errorName:
            error instanceof Error ? error.name : "UnknownError",
        });
        throw error;
      }
    },
  };
}

export type ProcessRuntime = {
  appDependencies: AppDependencies;
  driveSatisfactionService: DriveSatisfactionService;
  topicResurfaceCrossDeviceCoordinator:
    TopicResurfaceCrossDeviceCoordinator;
  distillationCrossDeviceCoordinator:
    DistillationCrossDeviceCoordinator;
  proactivityWakeCrossDeviceCoordinator:
    ProactivityWakeCrossDeviceCoordinator;
  runtimeEffectDeliveryCoordinator:
    RuntimeEffectDeliveryCoordinator;
  runtimeEffectDeliveryWorker:
    RuntimeEffectDeliveryWorker;
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
  const nativeLiveWorkWakePublisher =
    new DrizzleNativeLiveWorkWakePublisher(db);
  const nativeLiveWorkWakeBroker =
    new NativeLiveWorkWakeBroker(runtimeEnv.DATABASE_URL);
  const nativeLiveWorkWaitService =
    new NativeLiveWorkWaitService(
      new DrizzleNativeLiveWorkAvailability(db),
      nativeLiveWorkWakeBroker,
    );
  const diaryService = new DiaryService(new DrizzleDiaryRepository(db));
  const diaryCommentService = new DiaryCommentService(
    new DrizzleDiaryCommentRepository(db),
  );
  const toyCommandService = new ToyCommandService(
    new DrizzleToyCommandRepository(db),
    runtimeEnv.LEILEI_TOY_BRIDGE_USER_ID,
  );
  const globalSearchService = new GlobalSearchService(new DrizzleGlobalSearchRepository(db));
  const systemRepository = new DrizzleSystemRepository(db);
  const systemService = new SystemService(systemRepository, {
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
  const backgroundLoopOrchestrator = new BackgroundLoopOrchestrator({
    maxRunsPerCycle: 4,
    maxCostPerCycle: 4,
    maxConcurrent: 2,
  }, (event) => {
    if (event.name === "background_loop_job_failed") {
      logger.warn(event.name, {
        kind: event.kind,
        errorName: event.errorName,
      });
      return;
    }
    if (event.name === "background_loop_cycle_budget_exhausted") {
      logger.info(event.name, {
        pending: event.pending,
        runsStarted: event.runsStarted,
        costStarted: event.costStarted,
      });
      return;
    }
    logger.info(event.name, {
      kind: event.kind,
      ...(event.name === "background_loop_job_started"
        ? {
            priority: event.priority,
            cost: event.cost,
          }
        : {}),
    });
  });
  const topicResurfaceOpportunityConfig =
    getTopicResurfaceOpportunityConfig(runtimeEnv);
  const memoryDecayConfig = getMemoryDecayConfig(runtimeEnv);
  const proactivityWakeOpportunityConfig =
    getProactivityWakeOpportunityConfig(runtimeEnv);
  const backgroundOpportunityPolicy = new BackgroundOpportunityPolicy({
    decayEnabled: Boolean(memoryDecayConfig),
  });
  const distillationPlan =
    DEFAULT_BACKGROUND_TARGET_PLANS.distillation;
  const nativeLiveBackgroundModelService =
    new NativeLiveBackgroundModelQueueService(
      new DrizzleNativeLiveBackgroundModelQueueRepository(db),
      nativeLiveWorkWakePublisher,
    );
  const distillationProcessVersion = "distill-process-v1";
  const distillationCrossDeviceCoordinator =
    new DistillationCrossDeviceCoordinator(
      nativeLiveBackgroundModelService,
      new DrizzleNativeLiveConversationRepository(db),
      new DrizzleDistillationRuntimePort(
        db,
        distillationProcessVersion,
      ),
      {
        surfaceLimit: DEFAULT_NATIVE_LIVE_SURFACE_LIMIT,
        minSourceMessages: 8,
        maxMemoriesPerRun: 3,
        ruleVersion: "distill-rule-v1",
        processVersion: distillationProcessVersion,
        model: {
          provider: "claude_code",
          model: "runtime-selected",
          configVersion: "cross-device-v1",
          promptContractVersion:
            CLAUDE_CODE_DISTILLATION_PROMPT_CONTRACT_VERSION,
        },
      },
    );
  const distillationCrossDeviceBackgroundTrigger =
    new DistillationCrossDeviceBackgroundTrigger(
      backgroundLoopOrchestrator,
      distillationCrossDeviceCoordinator,
      DEFAULT_NATIVE_LIVE_SUBJECT_ID,
      {
        priority: distillationPlan.priority,
        cost: distillationPlan.cost,
      },
      (event) => {
        if (event.name === "distillation_cross_device_background_error") {
          logger.warn(event.name, {
            errorName: event.errorName,
          });
          return;
        }
        logger.info(event.name, {
          outcome: event.result.outcome,
        });
      },
    );
  const subjectStateBackgroundMaintenance =
    createDefaultSubjectStateBackgroundMaintenance(
      db,
      backgroundLoopOrchestrator,
      memoryDecayConfig,
    );
  const nativeLiveConversationService = new NativeLiveConversationService(
    new DrizzleNativeLiveConversationRepository(db),
  );
  const nativeLiveTurnPort = new DrizzleNativeLiveBackendTurnPort(db);
  const nativeLiveTurnWaitService =
    new NativeLiveTurnWaitService(
      nativeLiveTurnPort,
      nativeLiveWorkWakeBroker,
    );
  const nativeLiveMindFollowUpService = new NativeLiveMindFollowUpService(
    new DrizzleNativeLiveMindFollowUpRepository(db),
    nativeLiveTurnPort,
    nativeLiveBackendMind,
    undefined,
    distillationCrossDeviceBackgroundTrigger,
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
    nativeLiveWorkWakePublisher,
  );
  const nativeLiveRuntimeEventService =
    new NativeLiveRuntimeEventService(
      new DrizzleNativeLiveRuntimeEventRepository(db),
    );
  const nativeLiveRuntimeInteractionService =
    new NativeLiveRuntimeInteractionService(
      new DrizzleNativeLiveRuntimeInteractionRepository(db),
      nativeLiveWorkWakePublisher,
      nativeLiveWorkWakeBroker,
    );
  const nativeLiveRuntimeControlService =
    new NativeLiveRuntimeControlService(
      new DrizzleNativeLiveRuntimeControlRepository(db),
      nativeLiveWorkWakePublisher,
      nativeLiveWorkWakeBroker,
    );
  const proactivityWakeRepository =
    new DrizzleProactivityWakeRepository(db);
  const proactivityWakeOpportunitySource =
    proactivityWakeOpportunityConfig
      ? new DrizzleProactivityWakeOpportunitySource(
          db,
          proactivityWakeOpportunityConfig,
        )
      : null;
  const runtimeEffectRepository =
    new DrizzleRuntimeEffectRepository(db);
  const proactivityEffectMaterializer =
    new ProactivityEffectMaterializer(
      runtimeEffectRepository,
    );
  const runtimeEffectDeliveryCoordinator =
    new RuntimeEffectDeliveryCoordinator(
      runtimeEffectRepository,
      new DrizzleRuntimeEffectForegroundGuard(db),
    );
  const runtimeMessageEffectDeliveryAdapter =
    new RuntimeMessageEffectDeliveryAdapter(db);
  const runtimeEffectDeliveryWorker =
    new RuntimeEffectDeliveryWorker(
      backgroundLoopOrchestrator,
      runtimeEffectRepository,
      runtimeEffectDeliveryCoordinator,
      runtimeMessageEffectDeliveryAdapter,
      randomUUID(),
      (event) => {
        const { name, ...fields } = event;
        if (
          name === "runtime_effect_delivery_unknown"
          || name === "runtime_effect_delivery_failed"
        ) {
          logger.warn(name, fields);
          return;
        }
        logger.info(name, fields);
      },
    );
  const proactivityWakeCrossDeviceCoordinator =
    new ProactivityWakeCrossDeviceCoordinator(
      nativeLiveBackgroundModelService,
      proactivityWakeRepository,
      proactivityWakeOpportunitySource,
      undefined,
      undefined,
      proactivityEffectMaterializer,
      proactivityWakeOpportunityConfig
        ? runtimeEffectDeliveryWorker
        : null,
    );
  const proactivityWakePlan =
    proactivityWakeOpportunityConfig
      ? DEFAULT_BACKGROUND_TARGET_PLANS.proactivityWake
      : null;
  const proactivityWakeOpportunityProducer =
    proactivityWakeOpportunityConfig
      && proactivityWakeOpportunitySource
      && proactivityWakePlan
      ? new ProactivityWakeOpportunityProducer(
          backgroundLoopOrchestrator,
          proactivityWakeOpportunitySource,
          proactivityWakeCrossDeviceCoordinator,
          DEFAULT_NATIVE_LIVE_SUBJECT_ID,
          proactivityWakePlan,
        )
      : null;
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
  const nativeLiveBackgroundWorkflowCoordinator =
    new NativeLiveBackgroundWorkflowCoordinator([
      observeBackgroundWorkflowAdvancer(
        "distillation",
        distillationCrossDeviceCoordinator,
        logger,
      ),
      observeBackgroundWorkflowAdvancer(
        "proactivity_wake",
        proactivityWakeCrossDeviceCoordinator,
        logger,
      ),
      observeBackgroundWorkflowAdvancer(
        "topic_resurface",
        topicResurfaceCrossDeviceCoordinator,
        logger,
      ),
    ]);
  const topicResurfaceCrossDeviceOpportunity =
    topicResurfaceOpportunityConfig
      ? new TopicResurfaceCrossDeviceOpportunity(
          topicResurfaceCrossDeviceCoordinator,
          DEFAULT_NATIVE_LIVE_SUBJECT_ID,
          topicResurfaceOpportunityConfig,
        )
      : undefined;
  const companionBackgroundOpportunity =
    new CompanionBackgroundOpportunityService(
      subjectStateBackgroundMaintenance,
      backgroundOpportunityPolicy,
      runtimeEffectDeliveryWorker,
      proactivityWakeOpportunityProducer,
      topicResurfaceCrossDeviceOpportunity ?? null,
    );
  const nativeLiveSemanticService = new NativeLiveSemanticHandshakeService(
    new DrizzleNativeLiveSemanticScoringRepository(db),
    nativeLiveTurnPort,
    nativeLiveBackendMind,
    nativeLiveRelayService,
    nativeLiveWorkWakePublisher,
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
      {
        policy: "runtime_operational_records",
        retentionMs:
          RUNTIME_OPERATIONAL_RETENTION_DAYS
          * 24 * 60 * 60 * 1_000,
        deleteBatch: (cutoff, limit) =>
          deleteExpiredRuntimeOperationalRecordsBatch(
            db,
            cutoff,
            limit,
          ),
      },
    ],
    observe: createRetentionObserver(logger),
  });
  const publicToolProfiles = parseMcpToolProfiles(
    runtimeEnv.MCP_PUBLIC_TOOL_PROFILES,
    DEFAULT_PUBLIC_MCP_TOOL_PROFILES,
  );
  const internalToolProfiles = parseMcpToolProfiles(
    runtimeEnv.MCP_INTERNAL_TOOL_PROFILES,
    DEFAULT_INTERNAL_MCP_TOOL_PROFILES,
  );

    const createMcpSessionServer = createProductionMcpSessionServerFactory({
    activeUserRepository: systemRepository,
    diaryService,
    diaryCommentService,
    toyCommandService,
    globalSearchService,
    conversationArchiveReadService,
    conversationExclusionManagementService,
    todoService,
    universeService,
    healthService,
    sentinelService,
    bridgeService,
    bridgeAmbiguityAcceptanceEnabled: runtimeEnv.BRIDGE_AMBIGUITY_ACCEPTANCE_ENABLED,
    publicToolProfiles,
    internalToolProfiles,
    logger,
  });

  return {
    mcpSessionRegistry,
    logger,
    driveSatisfactionService,
    topicResurfaceCrossDeviceCoordinator,
    distillationCrossDeviceCoordinator,
    proactivityWakeCrossDeviceCoordinator,
    runtimeEffectDeliveryCoordinator,
    runtimeEffectDeliveryWorker,
    appDependencies: {
      logger,
      webDiaryService: diaryService,
      webDiaryCommentService: diaryCommentService,
      webSystemService: systemService,
      toyService: toyCommandService,
      webGlobalSearchService: globalSearchService,
      webTodoService: todoService,
      webExportService: exportService,
      webImportService: importService,
      webUniverseService: universeService,
      webBridgeService: bridgeService,
      nativeLiveProduction: {
        web: {
          coordinator: nativeLiveRelayPrepareCoordinator,
          relayService: nativeLiveRelayService,
          turnReader: nativeLiveTurnPort,
          turnWaitService: nativeLiveTurnWaitService,
          currentPathReader:
            new DrizzleNativeLiveCurrentPathReader(db),
          conversationService:
            nativeLiveConversationService,
          runtimeEventService:
            nativeLiveRuntimeEventService,
          runtimeInteractionService:
            nativeLiveRuntimeInteractionService,
          runtimeControlService:
            nativeLiveRuntimeControlService,
        },
        internal: {
          relayService: nativeLiveRelayService,
          workWaitService: nativeLiveWorkWaitService,
          semanticService: nativeLiveSemanticService,
          backgroundModelService:
            nativeLiveBackgroundModelService,
          backgroundModelCoordinator:
            nativeLiveBackgroundWorkflowCoordinator,
          ...(topicResurfaceCrossDeviceOpportunity
            ? {
                backgroundModelOpportunity:
                  topicResurfaceCrossDeviceOpportunity,
              }
            : {}),
          runtimeEventService:
            nativeLiveRuntimeEventService,
          runtimeInteractionService:
            nativeLiveRuntimeInteractionService,
          runtimeControlService:
            nativeLiveRuntimeControlService,
          companionBackgroundOpportunity:
            companionBackgroundOpportunity,
        },
      },
      webSentinelService: sentinelService,
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
      logger.info("cloud_background_mode", {
        state: "startup_recovery_only",
      });

      // Cloud runtime does not own periodic background cadence. Recover
      // durable work once at process start; Mac Companion/event-driven paths
      // own subsequent opportunities.
      void retentionCoordinator.runNow().catch(() => undefined);
      void nativeLiveMindFollowUpScheduler.runNow().catch(() => undefined);
      void nativeLiveSemanticScheduler.runNow().catch(() => undefined);
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
      // Event-driven finalization can still offer bounded orchestrator work.
      // Wait for that cycle before closing the shared database resource.
      await backgroundLoopOrchestrator.drain();
    },
    closeDatabase: async () => {
      await nativeLiveWorkWakeBroker.close();
      await database.close();
    },
  };
}
