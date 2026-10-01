import { randomUUID } from "node:crypto";
import {
  env,
  getBreathRankingConfig,
  getMcpGovernanceConfig,
  getNativeLiveAttachmentStorageConfig,
  getNativeLiveWakeBrokerConfig,
  getMemoryDecayConfig,
  getProactivityWakeOpportunityConfig,
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
import {
  DrizzleProjectWorkspaceRepository,
} from "../domains/project-workspace/project-workspace-repository.js";
import {
  ProjectWorkspaceService,
} from "../domains/project-workspace/project-workspace-service.js";
import {
  createDefaultBackendMindRuntime,
  createDefaultSubjectStateBackgroundMaintenance,
  DEFAULT_NATIVE_LIVE_SUBJECT_ID,
} from "../domains/runtime/default-backend-mind-runtime.js";
import {
  deleteExpiredNativeLiveBackgroundModelJobsBatch,
  DrizzleNativeLiveBackgroundModelQueueRepository,
  NativeLiveBackgroundModelQueueService,
} from "../domains/bridge/native-live-background-model-queue.js";
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
import {
  DrizzleNativeLiveConversationRuntimeMetadataReader,
} from "../domains/conversation/native-live-conversation-runtime-metadata.js";
import { DrizzleNativeLiveBackendTurnPort } from "../domains/bridge/native-live-backend-turn-repository.js";
import { NativeLiveBackendTurnCoordinator } from "../domains/bridge/native-live-backend-turn-coordinator.js";
import { NativeLiveBackendRelayPrepareCoordinator } from "../domains/bridge/native-live-backend-relay-prepare.js";
import {
  DrizzleNativeLiveBackendRelayRepository,
  NativeLiveBackendRelayService,
} from "../domains/bridge/native-live-backend-relay.js";
import {
  DrizzleNativeLiveProviderSessionCleanupRepository,
  NativeLiveProviderSessionCleanupService,
} from "../domains/bridge/native-live-provider-session-cleanup.js";
import {
  NativeLiveManualCompactService,
} from "../domains/bridge/native-live-manual-compact.js";
import {
  NativeLiveExternalSessionBridgeService,
} from "../domains/bridge/native-live-external-session-bridge.js";
import {
  NativeLiveAttachmentService,
  deleteExpiredNativeLiveAttachmentsBatch,
} from "../domains/bridge/native-live-attachment-service.js";
import {
  S3PresignedAttachmentObjectStore,
} from "../domains/bridge/native-live-attachment-storage.js";
import {
  PostgresInlineAttachmentObjectStore,
} from "../domains/bridge/native-live-attachment-postgres-storage.js";
import {
  DrizzleNativeLiveProviderSessionStoreRepository,
  NativeLiveProviderSessionStoreService,
} from "../domains/bridge/native-live-provider-session-store.js";
import {
  DrizzleNativeLiveWorkAvailability,
  DrizzleNativeLiveWorkWakePublisher,
  NativeLiveHttpWakeSignal,
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
  createNativeLiveMindFollowUpRecoveryRunner,
} from "../domains/bridge/native-live-mind-followup.js";
import { NativeLiveMindSemanticActionExecutor } from "../domains/bridge/native-live-mind-semantic-action.js";
import { DrizzleThoughtDropPort } from "../domains/runtime/thought-runtime-repository.js";
import { DrizzleSubjectStateRuntimePort } from "../domains/runtime/subject-state-runtime-repository.js";
import {
  DrizzleNativeLiveSemanticScoringRepository,
  NativeLiveSemanticHandshakeService,
  createNativeLiveSemanticRecoveryRunner,
} from "../domains/bridge/native-live-semantic-handshake.js";
import {
  MindProductService,
} from "../domains/runtime/mind-product-service.js";
import {
  DrizzleMindProductRepository,
} from "../domains/runtime/mind-product-repository.js";
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
import { DrizzleHealthRepository } from "../domains/health-v2/health-repository.js";
import { HealthService } from "../domains/health-v2/health-service.js";
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
  createRetentionObserver,
} from "../observability/runtime-observers.js";

type DatabaseResource = ReturnType<typeof createDatabase>;

type BackgroundWorkflowKind = "proactivity_wake";

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

function lazyBackgroundWorkflowAdvancer(
  workflowKind: BackgroundWorkflowKind,
  createAdvancer: () => NativeLiveBackgroundWorkflowAdvancer,
  logger: SafeLogger,
): NativeLiveBackgroundWorkflowAdvancer {
  let advancer: NativeLiveBackgroundWorkflowAdvancer | null = null;
  return observeBackgroundWorkflowAdvancer(
    workflowKind,
    {
      advanceNextForUser(input) {
        advancer ??= createAdvancer();
        return advancer.advanceNextForUser(input);
      },
    },
    logger,
  );
}
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
  const nativeLiveAttachmentStorageConfig =
    getNativeLiveAttachmentStorageConfig(runtimeEnv);
  const nativeLivePostgresAttachmentObjectStore =
    nativeLiveAttachmentStorageConfig
      ? undefined
      : new PostgresInlineAttachmentObjectStore(
          db,
          {
            signingSecret: runtimeEnv.DATABASE_URL,
            transferTtlSeconds:
              runtimeEnv.NATIVE_LIVE_ATTACHMENT_PRESIGN_TTL_SECONDS,
            maxFileBytes:
              runtimeEnv.NATIVE_LIVE_ATTACHMENT_MAX_FILE_BYTES,
            maxTotalBytes:
              runtimeEnv.NATIVE_LIVE_ATTACHMENT_MAX_TOTAL_BYTES,
          },
        );
  const nativeLiveAttachmentObjectStore =
    nativeLiveAttachmentStorageConfig
      ? new S3PresignedAttachmentObjectStore(
          nativeLiveAttachmentStorageConfig,
        )
      : nativeLivePostgresAttachmentObjectStore!;
  const nativeLiveAttachmentService =
    new NativeLiveAttachmentService(
      db,
      nativeLiveAttachmentObjectStore,
      {
        maxFileBytes:
          runtimeEnv.NATIVE_LIVE_ATTACHMENT_MAX_FILE_BYTES,
        unboundTtlSeconds:
          runtimeEnv.NATIVE_LIVE_ATTACHMENT_UNBOUND_TTL_SECONDS,
      },
    );
  const nativeLiveWakeBrokerConfig =
    getNativeLiveWakeBrokerConfig(runtimeEnv);
  const nativeLiveWorkWakePublisher =
    new DrizzleNativeLiveWorkWakePublisher(
      db,
      nativeLiveWakeBrokerConfig
        ? new NativeLiveHttpWakeSignal(
            nativeLiveWakeBrokerConfig.url,
            nativeLiveWakeBrokerConfig.token,
          )
        : null,
    );
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
  const projectWorkspaceService = new ProjectWorkspaceService(
    new DrizzleProjectWorkspaceRepository(db),
  );
  const mindProductService = new MindProductService(
    new DrizzleMindProductRepository(db),
    DEFAULT_NATIVE_LIVE_SUBJECT_ID,
  );
  const memoryDecayConfig = getMemoryDecayConfig(runtimeEnv);
  const breathRankingConfig = getBreathRankingConfig(runtimeEnv);
  const nativeLiveBackendMind = createDefaultBackendMindRuntime(
    db,
    memoryDecayConfig,
    breathRankingConfig,
  );
  const semanticMindActions =
    new NativeLiveMindSemanticActionExecutor(
      new DrizzleSubjectStateRuntimePort(db),
      new DrizzleThoughtDropPort(db),
      DEFAULT_NATIVE_LIVE_SUBJECT_ID,
    );
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
  // Legacy Proactivity v1 is intentionally retired while v2 is redesigned.
  // Keep historical wake/job/effect rows readable, but do not create,
  // execute, advance, or deliver any new v1 proactive work.
  const legacyProactivityV1Enabled = false;
  const proactivityWakeOpportunityConfig =
    getProactivityWakeOpportunityConfig(runtimeEnv);
  const backgroundOpportunityPolicy = new BackgroundOpportunityPolicy({
    decayEnabled: Boolean(memoryDecayConfig),
  });
  const nativeLiveBackgroundModelService =
    new NativeLiveBackgroundModelQueueService(
      new DrizzleNativeLiveBackgroundModelQueueRepository(db),
      nativeLiveWorkWakePublisher,
    );
  const nativeLiveBackgroundModelRelayService =
    legacyProactivityV1Enabled
      ? nativeLiveBackgroundModelService
      : {
          async reserveNext(
            _input: Parameters<
              NativeLiveBackgroundModelQueueService["reserveNext"]
            >[0],
          ) {
            return null;
          },
          submitResult(
            input: Parameters<
              NativeLiveBackgroundModelQueueService["submitResult"]
            >[0],
          ) {
            return nativeLiveBackgroundModelService.submitResult(input);
          },
        };

  const subjectStateBackgroundMaintenance =
    createDefaultSubjectStateBackgroundMaintenance(
      db,
      backgroundLoopOrchestrator,
      memoryDecayConfig,
    );
  const nativeLiveConversationService = new NativeLiveConversationService(
    new DrizzleNativeLiveConversationRepository(db),
  );
  const nativeLiveTurnPort = new DrizzleNativeLiveBackendTurnPort(
    db,
    memoryDecayConfig,
  );
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
    semanticMindActions,
  );
  const nativeLiveMindFollowUpRecovery =
    createNativeLiveMindFollowUpRecoveryRunner({
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
    runtimeEnv.NATIVE_LIVE_SEND_FILE_ENABLED ? 3 : 2,
  );
  const nativeLiveProviderSessionCleanupService =
    new NativeLiveProviderSessionCleanupService(
      new DrizzleNativeLiveProviderSessionCleanupRepository(db),
    );
  const nativeLiveManualCompactService =
    new NativeLiveManualCompactService(
      db,
      nativeLiveWorkWakePublisher,
    );
  const nativeLiveExternalSessionBridgeService =
    new NativeLiveExternalSessionBridgeService(
      db,
      nativeLiveWorkWakePublisher,
    );
  const nativeLiveProviderSessionStoreService =
    new NativeLiveProviderSessionStoreService(
      new DrizzleNativeLiveProviderSessionStoreRepository(db),
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
  const runtimeEffectRepository =
    new DrizzleRuntimeEffectRepository(db);
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

  const proactivityWakeOpportunitySource =
    legacyProactivityV1Enabled
      && proactivityWakeOpportunityConfig
      ? new DrizzleProactivityWakeOpportunitySource(
          db,
          proactivityWakeOpportunityConfig,
        )
      : null;
  let proactivityWakeCrossDeviceCoordinator:
    ProactivityWakeCrossDeviceCoordinator | null = null;
  const getProactivityWakeCrossDeviceCoordinator = () =>
    proactivityWakeCrossDeviceCoordinator ??=
      new ProactivityWakeCrossDeviceCoordinator(
        nativeLiveBackgroundModelService,
        new DrizzleProactivityWakeRepository(db),
        proactivityWakeOpportunitySource,
        undefined,
        undefined,
        new ProactivityEffectMaterializer(runtimeEffectRepository),
        proactivityWakeOpportunityConfig
          ? runtimeEffectDeliveryWorker
          : null,
      );
  const proactivityWakePlan =
    legacyProactivityV1Enabled
      && proactivityWakeOpportunityConfig
      ? DEFAULT_BACKGROUND_TARGET_PLANS.proactivityWake
      : null;
  const proactivityWakeOpportunityProducer =
    proactivityWakeOpportunityConfig
      && proactivityWakeOpportunitySource
      && proactivityWakePlan
      ? new ProactivityWakeOpportunityProducer(
          backgroundLoopOrchestrator,
          proactivityWakeOpportunitySource,
          getProactivityWakeCrossDeviceCoordinator(),
          DEFAULT_NATIVE_LIVE_SUBJECT_ID,
          proactivityWakePlan,
        )
      : null;

  const nativeLiveBackgroundWorkflowCoordinator =
    new NativeLiveBackgroundWorkflowCoordinator(
      legacyProactivityV1Enabled
        ? [
            lazyBackgroundWorkflowAdvancer(
              "proactivity_wake",
              getProactivityWakeCrossDeviceCoordinator,
              logger,
            ),
          ]
        : [],
    );
  const companionBackgroundOpportunity =
    new CompanionBackgroundOpportunityService(
      subjectStateBackgroundMaintenance,
      backgroundOpportunityPolicy,
      legacyProactivityV1Enabled
        ? runtimeEffectDeliveryWorker
        : null,
      legacyProactivityV1Enabled
        ? proactivityWakeOpportunityProducer
        : null,
      legacyProactivityV1Enabled
        && Boolean(proactivityWakeOpportunityConfig),
    );
  const nativeLiveSemanticService = new NativeLiveSemanticHandshakeService(
    new DrizzleNativeLiveSemanticScoringRepository(db),
    nativeLiveTurnPort,
    nativeLiveBackendMind,
    nativeLiveRelayService,
    nativeLiveWorkWakePublisher,
  );
  const nativeLiveSemanticRecovery =
    createNativeLiveSemanticRecoveryRunner({
      service: nativeLiveSemanticService,
    });
  const nativeLiveRelayPrepareCoordinator =
    new NativeLiveBackendRelayPrepareCoordinator(
      nativeLiveTurnPort,
      nativeLiveBackendMind,
      nativeLiveSemanticService,
    );
  const healthService = new HealthService(new DrizzleHealthRepository(db));
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
      ...(nativeLiveAttachmentObjectStore
        ? [{
            policy: "native_live_chat_attachments" as const,
            retentionMs: 0,
            deleteBatch: (cutoff: Date, limit: number) =>
              deleteExpiredNativeLiveAttachmentsBatch(
                db,
                nativeLiveAttachmentObjectStore,
                cutoff,
                limit,
              ),
          }]
        : []),
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
    todoService,
    universeService,
    healthService,
    publicToolProfiles,
    internalToolProfiles,
  });

  return {
    mcpSessionRegistry,
    logger,
    appDependencies: {
      logger,
      ...(nativeLivePostgresAttachmentObjectStore
        ? {
            nativeLiveAttachmentTransferStore:
              nativeLivePostgresAttachmentObjectStore,
          }
        : {}),
      webDiaryService: diaryService,
      webDiaryCommentService: diaryCommentService,
      webSystemService: systemService,
      toyService: toyCommandService,
      webGlobalSearchService: globalSearchService,
      webTodoService: todoService,
      webExportService: exportService,
      webImportService: importService,
      webUniverseService: universeService,
      webMindService: mindProductService,
      webProjectWorkspaceService: projectWorkspaceService,
      nativeLiveProduction: {
        web: {
          coordinator: nativeLiveRelayPrepareCoordinator,
          relayService: nativeLiveRelayService,
          turnReader: nativeLiveTurnPort,
          turnWaitService: nativeLiveTurnWaitService,
          currentPathReader:
            new DrizzleNativeLiveCurrentPathReader(db),
          conversationRuntimeMetadataReader:
            new DrizzleNativeLiveConversationRuntimeMetadataReader(db),
          conversationService:
            nativeLiveConversationService,
          runtimeEventService:
            nativeLiveRuntimeEventService,
          runtimeInteractionService:
            nativeLiveRuntimeInteractionService,
          runtimeControlService:
            nativeLiveRuntimeControlService,
          manualCompactService:
            nativeLiveManualCompactService,
          externalSessionBridgeService:
            nativeLiveExternalSessionBridgeService,
          ...(nativeLiveAttachmentService
            ? {
                attachmentService:
                  nativeLiveAttachmentService,
              }
            : {}),
        },
        internal: {
          relayService: nativeLiveRelayService,
          workWaitService: nativeLiveWorkWaitService,
          providerSessionCleanupService:
            nativeLiveProviderSessionCleanupService,
          manualCompactService:
            nativeLiveManualCompactService,
          externalSessionBridgeService:
            nativeLiveExternalSessionBridgeService,
          providerSessionStoreService:
            nativeLiveProviderSessionStoreService,
          ...(nativeLiveAttachmentService
            ? {
                attachmentService:
                  nativeLiveAttachmentService,
              }
            : {}),
          semanticService: nativeLiveSemanticService,
          backgroundModelService:
            nativeLiveBackgroundModelRelayService,
          backgroundModelCoordinator:
            nativeLiveBackgroundWorkflowCoordinator,
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
      healthSyncService: healthService,
      databaseReadinessProbe: database.probe,
      mcpSessionRegistry,
      createMcpSessionServer,
    },
    startBackgroundWork: () => {
      logger.info("cloud_background_mode", {
        state: "semantic_startup_recovery_only",
        operationalRetention: "startup_then_while_process_awake",
      });

      // Semantic/model background cadence remains Mac Companion-owned.
      // Infrastructure retention is deterministic database housekeeping, so
      // the cloud runtime owns its bounded cadence while this process is awake.
      // start() also runs once immediately, which catches up after sleep/restart.
      retentionCoordinator.start();
      const mindFollowUpStartupRecovery =
        nativeLiveMindFollowUpRecovery.runNow().catch(() => 0);
      void mindFollowUpStartupRecovery;
      void nativeLiveSemanticRecovery.runNow().catch(() => undefined);
    },
    stopBackgroundWork: () => {
      retentionCoordinator.stopScheduling();
      nativeLiveMindFollowUpRecovery.stop();
      nativeLiveSemanticRecovery.stop();
    },
    drainBackgroundWork: async () => {
      await Promise.all([
        retentionCoordinator.drain(),
        nativeLiveMindFollowUpRecovery.drain(),
        nativeLiveSemanticRecovery.drain(),
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
