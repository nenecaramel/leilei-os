import { randomUUID } from "node:crypto";
import {
  env,
  getBreathRankingConfig,
  getMcpGovernanceConfig,
  getMemoryDecayConfig,
  getMindLifecycleTuningConfig,
  getMindRetirementConfig,
  getMindSemanticGroupingConfig,
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
import {
  createDefaultBackendMindRuntime,
  createDefaultDriveSatisfactionService,
  createDefaultCuriosityResolutionService,
  createDefaultSubjectStateBackgroundMaintenance,
  DEFAULT_NATIVE_LIVE_SUBJECT_ID,
  DEFAULT_DISTILLATION_SETTLEMENT_LAG_MESSAGES,
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
  DrizzleNativeLiveProviderSessionCleanupRepository,
  NativeLiveProviderSessionCleanupService,
} from "../domains/bridge/native-live-provider-session-cleanup.js";
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
  createNativeLiveMindFollowUpRecoveryRunner,
} from "../domains/bridge/native-live-mind-followup.js";
import { NativeLiveMindSemanticActionExecutor } from "../domains/bridge/native-live-mind-semantic-action.js";
import {
  DrizzleNativeLiveSemanticScoringRepository,
  NativeLiveSemanticHandshakeService,
  createNativeLiveSemanticRecoveryRunner,
} from "../domains/bridge/native-live-semantic-handshake.js";
import {
  MindSemanticGroupingService,
} from "../domains/runtime/mind-semantic-grouping.js";
import {
  DrizzleMindSemanticGroupingRepository,
} from "../domains/runtime/mind-semantic-grouping-runtime-repository.js";
import {
  MindRetirementPreviewService,
  type MindRetirementPreview,
} from "../domains/runtime/mind-retirement-preview.js";
import {
  DrizzleMindRetirementRuntimePort,
} from "../domains/runtime/mind-retirement-runtime-repository.js";
import {
  MindCompatibilityCensusService,
  type MindCompatibilityCensus,
} from "../domains/runtime/mind-compatibility-census.js";
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

function logMindRetirementPreview(
  logger: SafeLogger,
  preview: MindRetirementPreview,
): void {
  logger.info("mind_retirement_preview_summary", {
    scannedAnchors: preview.scannedAnchors,
    truncated: preview.truncated,
  });
  for (const kind of preview.kinds) {
    logger.info("mind_retirement_preview_kind", {
      mindKind: kind.kind,
      scannedAnchors: kind.scannedAnchors,
      terminalAnchors: kind.terminalAnchors,
      nonTerminalAnchors: kind.nonTerminalAnchors,
      unreadableAnchors: kind.unreadableAnchors,
      minAgeHours: kind.terminalAgeHours?.min ?? null,
      p50AgeHours: kind.terminalAgeHours?.p50 ?? null,
      p90AgeHours: kind.terminalAgeHours?.p90 ?? null,
      maxAgeHours: kind.terminalAgeHours?.max ?? null,
    });
    for (const retention of kind.eligibleByRetention) {
      logger.info("mind_retirement_preview_retention", {
        mindKind: kind.kind,
        retentionHours: retention.retentionHours,
        eligibleThreads: retention.threads,
      });
    }
  }
}

function logMindCompatibilityCensus(
  logger: SafeLogger,
  census: MindCompatibilityCensus,
): void {
  logger.info("mind_compatibility_census", {
    legacyDreamStates: census.legacyDreamStates,
    legacyAuthoredTopicStates: census.legacyAuthoredTopicStates,
    legacyMemoryRecallWithoutLedger:
      census.legacyMemoryRecallWithoutLedger,
    legacyOpenMindFollowUps: census.legacyOpenMindFollowUps,
    legacyOpenDreamIntents: census.legacyOpenDreamIntents,
    legacyOpenTopicIntents: census.legacyOpenTopicIntents,
    quarantinedMindFollowUps: census.quarantinedMindFollowUps,
  });
}

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
  const memoryDecayConfig = getMemoryDecayConfig(runtimeEnv);
  const breathRankingConfig = getBreathRankingConfig(runtimeEnv);
  const mindSemanticGroupingConfig =
    getMindSemanticGroupingConfig(runtimeEnv);
  const mindLifecycleTuningConfig =
    getMindLifecycleTuningConfig(runtimeEnv);
  const mindRetirementConfig =
    getMindRetirementConfig(runtimeEnv);
  const mindRetirementPreviewService = runtimeEnv.MCP_USER_ID
    ? new MindRetirementPreviewService(
        new DrizzleMindRetirementRuntimePort(db),
      )
    : null;
  let mindRetirementPreviewRun: Promise<void> | null = null;
  const mindCompatibilityCensusService = runtimeEnv.MCP_USER_ID
    ? new MindCompatibilityCensusService(db)
    : null;
  let mindCompatibilityCensusRun: Promise<void> | null = null;
  const mindSemanticGroupingRepository =
    new DrizzleMindSemanticGroupingRepository(
      db,
      nativeLiveWorkWakePublisher,
    );
  const mindSemanticGrouping =
    mindSemanticGroupingConfig
      ? new MindSemanticGroupingService(
          mindSemanticGroupingRepository,
          mindSemanticGroupingConfig,
        )
      : null;
  const nativeLiveBackendMind = createDefaultBackendMindRuntime(
    db,
    memoryDecayConfig,
    breathRankingConfig,
    mindLifecycleTuningConfig,
  );
  const driveSatisfactionService =
    createDefaultDriveSatisfactionService(
      db,
      mindLifecycleTuningConfig,
    );
  const curiosityResolutionService =
    createDefaultCuriosityResolutionService(
      db,
      mindLifecycleTuningConfig,
    );
  const semanticMindActions =
    new NativeLiveMindSemanticActionExecutor(
      driveSatisfactionService,
      curiosityResolutionService,
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
  const topicResurfaceOpportunityConfig =
    getTopicResurfaceOpportunityConfig(runtimeEnv);
  const proactivityWakeOpportunityConfig =
    getProactivityWakeOpportunityConfig(runtimeEnv);
  const backgroundOpportunityPolicy = new BackgroundOpportunityPolicy({
    decayEnabled: Boolean(memoryDecayConfig),
    mindRetirementEnabled: Boolean(mindRetirementConfig),
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
        settlementLagMessages: DEFAULT_DISTILLATION_SETTLEMENT_LAG_MESSAGES,
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
      mindSemanticGrouping,
      mindLifecycleTuningConfig,
      mindRetirementConfig,
    );
  const nativeLiveConversationService = new NativeLiveConversationService(
    new DrizzleNativeLiveConversationRepository(
      db,
      memoryDecayConfig,
    ),
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
    distillationCrossDeviceBackgroundTrigger,
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
  );
  const nativeLiveProviderSessionCleanupService =
    new NativeLiveProviderSessionCleanupService(
      new DrizzleNativeLiveProviderSessionCleanupRepository(db),
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
    proactivityWakeOpportunityConfig
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
          getProactivityWakeCrossDeviceCoordinator(),
          DEFAULT_NATIVE_LIVE_SUBJECT_ID,
          proactivityWakePlan,
        )
      : null;

  let topicResurfaceCrossDeviceCoordinator:
    TopicResurfaceCrossDeviceCoordinator | null = null;
  const getTopicResurfaceCrossDeviceCoordinator = () =>
    topicResurfaceCrossDeviceCoordinator ??=
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
      lazyBackgroundWorkflowAdvancer(
        "proactivity_wake",
        getProactivityWakeCrossDeviceCoordinator,
        logger,
      ),
      lazyBackgroundWorkflowAdvancer(
        "topic_resurface",
        getTopicResurfaceCrossDeviceCoordinator,
        logger,
      ),
    ]);
  const topicResurfaceCrossDeviceOpportunity =
    topicResurfaceOpportunityConfig
      ? new TopicResurfaceCrossDeviceOpportunity(
          getTopicResurfaceCrossDeviceCoordinator(),
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
      Boolean(proactivityWakeOpportunityConfig),
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
      webDiaryService: diaryService,
      webDiaryCommentService: diaryCommentService,
      webSystemService: systemService,
      toyService: toyCommandService,
      webGlobalSearchService: globalSearchService,
      webTodoService: todoService,
      webExportService: exportService,
      webImportService: importService,
      webUniverseService: universeService,
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
          providerSessionCleanupService:
            nativeLiveProviderSessionCleanupService,
          semanticService: nativeLiveSemanticService,
          mindSemanticGrouping:
            mindSemanticGroupingRepository,
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
      const mindFollowUpStartupRecovery =
        nativeLiveMindFollowUpRecovery.runNow().catch(() => 0);
      void mindFollowUpStartupRecovery;
      void nativeLiveSemanticRecovery.runNow().catch(() => undefined);
      if (
        mindRetirementPreviewService
        && runtimeEnv.MCP_USER_ID
        && !mindRetirementPreviewRun
      ) {
        mindRetirementPreviewRun = mindRetirementPreviewService.preview({
          userId: runtimeEnv.MCP_USER_ID,
          subjectId: DEFAULT_NATIVE_LIVE_SUBJECT_ID,
          now: new Date().toISOString(),
          limit: 2_000,
        }).then((preview) => {
          logMindRetirementPreview(logger, preview);
        }).catch((error) => {
          logger.warn("mind_retirement_preview_failed", {
            name: error instanceof Error ? error.name : "UnknownError",
          });
        });
      }
      if (
        mindCompatibilityCensusService
        && runtimeEnv.MCP_USER_ID
        && !mindCompatibilityCensusRun
      ) {
        mindCompatibilityCensusRun = mindFollowUpStartupRecovery
          .then(() => mindCompatibilityCensusService.read({
            userId: runtimeEnv.MCP_USER_ID!,
            subjectId: DEFAULT_NATIVE_LIVE_SUBJECT_ID,
          }))
          .then((census) => {
            logMindCompatibilityCensus(logger, census);
          }).catch((error) => {
            logger.warn("mind_compatibility_census_failed", {
              name: error instanceof Error ? error.name : "UnknownError",
            });
          });
      }
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
        mindRetirementPreviewRun ?? Promise.resolve(),
        mindCompatibilityCensusRun ?? Promise.resolve(),
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
