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
import type {
  MindSemanticGroupingService,
} from "./mind-semantic-grouping.js";
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
import {
  MindRetirementService,
} from "./mind-retirement.js";
import {
  DrizzleMindRetirementRuntimePort,
} from "./mind-retirement-runtime-repository.js";
import type {
  MindRetirementPolicy,
} from "./mind-retirement-policy.js";

type Database = ReturnType<typeof createDatabase>["db"];

export const DEFAULT_NATIVE_LIVE_SUBJECT_ID = "G";

export type MindLifecycleTuning = {
  drive: {
    basePressure: number;
    reinforcementBoost: number;
    activeThreshold: number;
    dormantAfterSatisfiedHours: number;
  };
  thought: {
    halfLifeHours: number;
    baseStrength: number;
    reinforcementBoost: number;
    dormantBelowStrength: number;
  };
  curiosity: {
    dormantAfterHours: number;
  };
  topic: {
    dormantAfterHours: number;
  };
};

export const DEFAULT_MIND_LIFECYCLE_TUNING: MindLifecycleTuning = {
  drive: {
    basePressure: 0.4,
    reinforcementBoost: 0.2,
    activeThreshold: 0.1,
    dormantAfterSatisfiedHours: 168,
  },
  thought: {
    halfLifeHours: 168,
    baseStrength: 0.35,
    reinforcementBoost: 0.25,
    dormantBelowStrength: 0.1,
  },
  curiosity: {
    dormantAfterHours: 168,
  },
  topic: {
    dormantAfterHours: 168,
  },
};
// Recall is evidence of relevance for this turn, not new evidence that the
// memory itself became more important. Keep lifecycle salience unchanged.
export const DEFAULT_BREATH_RECALL_SALIENCE_BOOST = 0;
export const DEFAULT_BREATH_SALIENCE_WEIGHT = 0.1;
// Used by background Distillation only; foreground Claude prompt assembly no longer injects canonical Surface.
export const DEFAULT_DISTILLATION_SETTLEMENT_LAG_MESSAGES = 8;
export const DEFAULT_NATIVE_LIVE_CONTEXT_TIME_ZONE = "Asia/Shanghai";

export const DEFAULT_DRIVE_EVOLUTION_POLICY: DriveEvolutionPolicy = {
  ...DEFAULT_MIND_LIFECYCLE_TUNING.drive,
  minEvolutionIntervalHours: 6,
  maxReinforcementSources: 16,
};

const DEFAULT_THOUGHT_EVOLUTION_POLICY = {
  ...DEFAULT_MIND_LIFECYCLE_TUNING.thought,
  minEvolutionIntervalHours: 6,
  maxReinforcementSources: 16,
};

export const DEFAULT_CURIOSITY_EVOLUTION_POLICY: CuriosityEvolutionPolicy = {
  maxReinforcementSources: 16,
  ...DEFAULT_MIND_LIFECYCLE_TUNING.curiosity,
};

const DEFAULT_TOPIC_EVOLUTION_POLICY = {
  maxReinforcementSources: 16,
  ...DEFAULT_MIND_LIFECYCLE_TUNING.topic,
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

function drivePolicy(
  tuning: MindLifecycleTuning,
): DriveEvolutionPolicy {
  return {
    ...DEFAULT_DRIVE_EVOLUTION_POLICY,
    ...tuning.drive,
  };
}

function thoughtPolicy(tuning: MindLifecycleTuning) {
  return {
    ...DEFAULT_THOUGHT_EVOLUTION_POLICY,
    ...tuning.thought,
  };
}

function curiosityPolicy(
  tuning: MindLifecycleTuning,
): CuriosityEvolutionPolicy {
  return {
    ...DEFAULT_CURIOSITY_EVOLUTION_POLICY,
    ...tuning.curiosity,
  };
}

function topicPolicy(tuning: MindLifecycleTuning) {
  return {
    ...DEFAULT_TOPIC_EVOLUTION_POLICY,
    ...tuning.topic,
  };
}

export function createDefaultBackendMindRuntime(
  db: Database,
  memoryLifecyclePolicy?: MemoryLifecyclePolicy,
  breathRanking: {
    salienceWeight: number;
  } = {
    salienceWeight: DEFAULT_BREATH_SALIENCE_WEIGHT,
  },
  lifecycleTuning: MindLifecycleTuning =
    DEFAULT_MIND_LIFECYCLE_TUNING,
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
      breathSalienceWeight: breathRanking.salienceWeight,
      breathRecallSalienceBoost: DEFAULT_BREATH_RECALL_SALIENCE_BOOST,
      ...(memoryLifecyclePolicy ? { memoryLifecyclePolicy } : {}),
      breathSemanticWeight: 0.65,
      breathSemanticMinScore: 0.80,
      breathSemanticCandidateLimit: 256,
      breathSemanticCandidateMaxChars: 2_000,
      driveLimit: 3,
      thoughtLimit: 3,
      thoughtMinStrength: lifecycleTuning.thought.dormantBelowStrength,
      curiosityLimit: 3,
      topicLimit: 3,
      maxContextItems: 16,
      maxContextChars: 8_000,
    },
    null,
  );
  const driveEvolution = new DriveEvolutionService(
    new DrizzleDriveEvolutionRuntimePort(db),
    drivePolicy(lifecycleTuning),
  );
  const thoughtEvolution = new ThoughtEvolutionService(
    new DrizzleThoughtEvolutionRuntimePort(db),
    thoughtPolicy(lifecycleTuning),
  );
  const curiosityEvolution = new CuriosityEvolutionService(
    new DrizzleCuriosityEvolutionRuntimePort(db),
    curiosityPolicy(lifecycleTuning),
  );
  const curiosityTopicProjection = new CuriosityTopicProjectionService(
    new DrizzleCuriosityTopicProjectionRuntimePort(db),
  );
  const topicEvolution = new TopicEvolutionService(
    new DrizzleTopicEvolutionRuntimePort(db),
    topicPolicy(lifecycleTuning),
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
  semanticGrouping:
    Pick<MindSemanticGroupingService, "reconcile"> | null = null,
  lifecycleTuning: MindLifecycleTuning =
    DEFAULT_MIND_LIFECYCLE_TUNING,
  retirementPolicy?: MindRetirementPolicy,
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
        thoughtPolicy(lifecycleTuning),
        semanticGrouping,
      ),
      driveEvolution: new DriveEvolutionService(
        new DrizzleDriveEvolutionRuntimePort(db),
        drivePolicy(lifecycleTuning),
        semanticGrouping,
      ),
      curiosityEvolution: new CuriosityEvolutionService(
        new DrizzleCuriosityEvolutionRuntimePort(db),
        curiosityPolicy(lifecycleTuning),
        semanticGrouping,
      ),
      curiosityTopicProjection: new CuriosityTopicProjectionService(
        new DrizzleCuriosityTopicProjectionRuntimePort(db),
      ),
      topicEvolution: new TopicEvolutionService(
        new DrizzleTopicEvolutionRuntimePort(db),
        topicPolicy(lifecycleTuning),
        semanticGrouping,
      ),
      ...(retirementPolicy && Object.keys(retirementPolicy).length > 0
        ? {
            mindRetirement: new MindRetirementService(
              new DrizzleMindRetirementRuntimePort(db),
              retirementPolicy,
            ),
          }
        : {}),
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
      ...(retirementPolicy && Object.keys(retirementPolicy).length > 0
        ? {
            mindRetirement: {
              priority:
                DEFAULT_BACKGROUND_TARGET_PLANS.mindRetirement.priority,
              cost: DEFAULT_BACKGROUND_TARGET_PLANS.mindRetirement.cost,
              limit: 100,
            },
          }
        : {}),
    },
  );
}

export function createDefaultDriveSatisfactionService(
  db: Database,
  lifecycleTuning: MindLifecycleTuning =
    DEFAULT_MIND_LIFECYCLE_TUNING,
): DriveSatisfactionService {
  return new DriveSatisfactionService(
    new DrizzleDriveEvolutionRuntimePort(db),
    new DrizzleDriveSatisfactionRuntimePort(db),
    drivePolicy(lifecycleTuning),
  );
}


export function createDefaultCuriosityResolutionService(
  db: Database,
  lifecycleTuning: MindLifecycleTuning =
    DEFAULT_MIND_LIFECYCLE_TUNING,
): CuriosityResolutionService {
  return new CuriosityResolutionService(
    new CuriosityEvolutionService(
      new DrizzleCuriosityEvolutionRuntimePort(db),
      curiosityPolicy(lifecycleTuning),
    ),
    new DrizzleCuriosityResolutionRuntimePort(db),
  );
}
