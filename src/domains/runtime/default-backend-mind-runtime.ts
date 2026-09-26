import type { createDatabase } from "../../database/client.js";
import { DrizzleNativeLiveConversationRepository } from "../conversation/native-live-conversation-repository.js";
import {
  DefaultNativeLiveBackendMindRuntime,
} from "../bridge/native-live-backend-mind-runtime.js";
import {
  DefaultNativeLiveMindRuntime,
} from "./native-live-mind-runtime.js";
import {
  NativeLiveMindLoopService,
} from "./native-live-mind-loop-service.js";
import {
  DrizzleSubjectStateRuntimePort,
} from "./subject-state-runtime-repository.js";
import {
  DriveEvolutionService,
  type DriveEvolutionPolicy,
} from "./drive-evolution.js";
import {
  DrizzleDriveEvolutionRuntimePort,
} from "./drive-evolution-runtime-repository.js";
import {
  DriveSatisfactionService,
  DrizzleDriveSatisfactionRuntimePort,
} from "./drive-satisfaction-runtime-repository.js";
import {
  ThoughtEvolutionService,
} from "./thought-evolution.js";
import {
  DrizzleThoughtEvolutionRuntimePort,
} from "./thought-evolution-runtime-repository.js";
import {
  TopicEvolutionService,
} from "./topic-evolution.js";
import {
  DrizzleTopicEvolutionRuntimePort,
} from "./topic-evolution-runtime-repository.js";
import {
  CuriosityEvolutionService,
  type CuriosityEvolutionPolicy,
} from "./curiosity-evolution.js";
import {
  DrizzleCuriosityEvolutionRuntimePort,
} from "./curiosity-evolution-runtime-repository.js";
import {
  CuriosityResolutionService,
} from "./curiosity-resolution.js";
import {
  DrizzleCuriosityResolutionRuntimePort,
} from "./curiosity-resolution-runtime-repository.js";
import {
  CuriosityTopicProjectionService,
} from "./curiosity-topic-projection.js";
import {
  DrizzleCuriosityTopicProjectionRuntimePort,
} from "./curiosity-topic-projection-runtime-repository.js";
import type {
  BackgroundLoopOrchestrator,
} from "./background-loop-orchestrator.js";
import {
  SubjectStateBackgroundMaintenance,
  type SubjectStateBackgroundMaintenanceConfig,
} from "./subject-state-background-maintenance.js";
import {
  SubjectStateSettlementCatchUp,
} from "./subject-state-settlement-catch-up.js";
import {
  MemoryLifecycleService,
  type MemoryLifecyclePolicy,
} from "./memory-lifecycle.js";
import {
  DrizzleMemoryLifecycleRuntimePort,
} from "./memory-lifecycle-runtime-repository.js";
import {
  DEFAULT_BACKGROUND_TARGET_PLANS,
} from "./background-opportunity-policy.js";

type Database = ReturnType<typeof createDatabase>["db"];

export const DEFAULT_NATIVE_LIVE_SUBJECT_ID = "G";
export const DEFAULT_BREATH_RECALL_SALIENCE_BOOST = 0.08;
// Used by background Distillation only; foreground Claude prompt assembly no longer injects canonical Surface.
export const DEFAULT_DISTILLATION_SETTLEMENT_LAG_MESSAGES = 8;
export const DEFAULT_NATIVE_LIVE_CONTEXT_TIME_ZONE = "Asia/Shanghai";

export const DEFAULT_DRIVE_EVOLUTION_POLICY: DriveEvolutionPolicy = {
  basePressure: 0.4,
  reinforcementBoost: 0.2,
  activeThreshold: 0.1,
  dormantAfterSatisfiedHours: 168,
  minEvolutionIntervalHours: 6,
  maxReinforcementSources: 16,
};

const DEFAULT_THOUGHT_EVOLUTION_POLICY = {
  halfLifeHours: 168,
  baseStrength: 0.35,
  reinforcementBoost: 0.25,
  dormantBelowStrength: 0.1,
  minEvolutionIntervalHours: 6,
  maxReinforcementSources: 16,
};

export const DEFAULT_CURIOSITY_EVOLUTION_POLICY: CuriosityEvolutionPolicy = {
  maxReinforcementSources: 16,
  dormantAfterHours: 168,
};

const DEFAULT_TOPIC_EVOLUTION_POLICY = {
  maxReinforcementSources: 16,
  dormantAfterHours: 168,
};

export const DEFAULT_SUBJECT_STATE_BACKGROUND_MAINTENANCE_CONFIG:
  SubjectStateBackgroundMaintenanceConfig = {
    thoughtEvolution: {
      priority:
        DEFAULT_BACKGROUND_TARGET_PLANS.thoughtEvolution.priority,
      cost: DEFAULT_BACKGROUND_TARGET_PLANS.thoughtEvolution.cost,
    },
    driveEvolution: {
      priority:
        DEFAULT_BACKGROUND_TARGET_PLANS.driveEvolution.priority,
      cost: DEFAULT_BACKGROUND_TARGET_PLANS.driveEvolution.cost,
    },
    topicLifecycle: {
      priority:
        DEFAULT_BACKGROUND_TARGET_PLANS.topicLifecycle.priority,
      cost: DEFAULT_BACKGROUND_TARGET_PLANS.topicLifecycle.cost,
    },
  };

export function createDefaultBackendMindRuntime(
  db: Database,
  memoryLifecyclePolicy?: MemoryLifecyclePolicy,
): DefaultNativeLiveBackendMindRuntime {
  const conversations = new DrizzleNativeLiveConversationRepository(db);
  const subjectState = new DrizzleSubjectStateRuntimePort(db);
  const loop = new NativeLiveMindLoopService(
    subjectState,
    {
      assemblyVersion: "assembly-v1",
      promptContractVersion: "prompt-v4",
      contextTimeZone: DEFAULT_NATIVE_LIVE_CONTEXT_TIME_ZONE,
      ruleVersion: "mind-v1",
      processVersion: "subject-write-v1",
      breathLimit: 4,
      breathCooldownHours: 0,
      breathSalienceWeight: 0,
      breathRecallSalienceBoost: DEFAULT_BREATH_RECALL_SALIENCE_BOOST,
      ...(memoryLifecyclePolicy ? { memoryLifecyclePolicy } : {}),
      breathSemanticWeight: 0.65,
      breathSemanticMinScore: 0.80,
      breathSemanticCandidateLimit: 64,
      breathSemanticCandidateMaxChars: 2_000,
      driveLimit: 3,
      thoughtLimit: 3,
      thoughtMinStrength: 0.1,
      curiosityLimit: 3,
      topicLimit: 3,
      maxContextItems: 16,
      maxContextChars: 8_000,
    },
    null,
  );
  const driveEvolution = new DriveEvolutionService(
    new DrizzleDriveEvolutionRuntimePort(db),
    DEFAULT_DRIVE_EVOLUTION_POLICY,
  );
  const thoughtEvolution = new ThoughtEvolutionService(
    new DrizzleThoughtEvolutionRuntimePort(db),
    DEFAULT_THOUGHT_EVOLUTION_POLICY,
  );
  const curiosityEvolution = new CuriosityEvolutionService(
    new DrizzleCuriosityEvolutionRuntimePort(db),
    DEFAULT_CURIOSITY_EVOLUTION_POLICY,
  );
  const curiosityTopicProjection = new CuriosityTopicProjectionService(
    new DrizzleCuriosityTopicProjectionRuntimePort(db),
  );
  const topicEvolution = new TopicEvolutionService(
    new DrizzleTopicEvolutionRuntimePort(db),
    DEFAULT_TOPIC_EVOLUTION_POLICY,
  );
  const mind = new DefaultNativeLiveMindRuntime(loop, {
    subjectId: DEFAULT_NATIVE_LIVE_SUBJECT_ID,
  });
  const settlementCatchUp = new SubjectStateSettlementCatchUp(
    DEFAULT_NATIVE_LIVE_SUBJECT_ID,
    {
      driveEvolution,
      thoughtEvolution,
      curiosityEvolution,
      curiosityTopicProjection,
      topicEvolution,
    },
  );
  return new DefaultNativeLiveBackendMindRuntime(
    conversations,
    mind,
    settlementCatchUp,
  );
}

export function createDefaultSubjectStateBackgroundMaintenance(
  db: Database,
  orchestrator: Pick<BackgroundLoopOrchestrator, "schedule">,
  decayPolicy?: MemoryLifecyclePolicy,
): SubjectStateBackgroundMaintenance {
  return new SubjectStateBackgroundMaintenance(
    orchestrator,
    DEFAULT_NATIVE_LIVE_SUBJECT_ID,
    {
      ...(decayPolicy
        ? {
            decay: new MemoryLifecycleService(
              new DrizzleMemoryLifecycleRuntimePort(db),
              decayPolicy,
            ),
          }
        : {}),
      thoughtEvolution: new ThoughtEvolutionService(
        new DrizzleThoughtEvolutionRuntimePort(db),
        DEFAULT_THOUGHT_EVOLUTION_POLICY,
      ),
      driveEvolution: new DriveEvolutionService(
        new DrizzleDriveEvolutionRuntimePort(db),
        DEFAULT_DRIVE_EVOLUTION_POLICY,
      ),
      curiosityEvolution: new CuriosityEvolutionService(
        new DrizzleCuriosityEvolutionRuntimePort(db),
        DEFAULT_CURIOSITY_EVOLUTION_POLICY,
      ),
      curiosityTopicProjection: new CuriosityTopicProjectionService(
        new DrizzleCuriosityTopicProjectionRuntimePort(db),
      ),
      topicEvolution: new TopicEvolutionService(
        new DrizzleTopicEvolutionRuntimePort(db),
        DEFAULT_TOPIC_EVOLUTION_POLICY,
      ),
    },
    {
      ...(decayPolicy
        ? {
            decay: {
              priority: DEFAULT_BACKGROUND_TARGET_PLANS.decay.priority,
              cost: DEFAULT_BACKGROUND_TARGET_PLANS.decay.cost,
            },
          }
        : {}),
      ...DEFAULT_SUBJECT_STATE_BACKGROUND_MAINTENANCE_CONFIG,
    },
  );
}

export function createDefaultDriveSatisfactionService(
  db: Database,
): DriveSatisfactionService {
  return new DriveSatisfactionService(
    new DrizzleDriveEvolutionRuntimePort(db),
    new DrizzleDriveSatisfactionRuntimePort(db),
    DEFAULT_DRIVE_EVOLUTION_POLICY,
  );
}


export function createDefaultCuriosityResolutionService(
  db: Database,
): CuriosityResolutionService {
  return new CuriosityResolutionService(
    new CuriosityEvolutionService(
      new DrizzleCuriosityEvolutionRuntimePort(db),
      DEFAULT_CURIOSITY_EVOLUTION_POLICY,
    ),
    new DrizzleCuriosityResolutionRuntimePort(db),
  );
}
