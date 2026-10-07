import type { createDatabase } from "../../../database/client.js";
import { DrizzleNativeLiveConversationRepository } from "../../conversation/native-live-conversation-repository.js";
import {
  DefaultNativeLiveBackendMindRuntime,
} from "../../bridge/mind/native-live-backend-mind-runtime.js";
import {
  DrizzleNativeLiveContextLineageReader,
} from "../../bridge/turn/native-live-context-lineage-repository.js";
import {
  DefaultNativeLiveMindRuntime,
} from "./native-live-mind-runtime.js";
import {
  NativeLiveMindLoopService,
  type MindLoopConfig,
} from "./native-live-mind-loop-service.js";
import {
  DrizzleSubjectStateRuntimePort,
} from "../subject-state/subject-state-runtime-repository.js";
import type {
  BackgroundLoopOrchestrator,
} from "../background/background-loop-orchestrator.js";
import {
  SubjectStateBackgroundMaintenance,
  type SubjectStateBackgroundMaintenanceConfig,
} from "../background/subject-state-background-maintenance.js";
import {
  MemoryLifecycleService,
  type MemoryLifecyclePolicy,
} from "../lifecycle/memory-lifecycle.js";
import {
  DrizzleMemoryLifecycleRuntimePort,
} from "../lifecycle/memory-lifecycle-runtime-repository.js";
import {
  DEFAULT_BACKGROUND_TARGET_PLANS,
} from "../background/background-opportunity-policy.js";

type Database = ReturnType<typeof createDatabase>["db"];

export const DEFAULT_NATIVE_LIVE_SUBJECT_ID = "G";

// Recall is evidence of relevance for this turn, not new evidence that the
// memory itself became more important. Keep lifecycle salience unchanged.
export const DEFAULT_BREATH_RECALL_SALIENCE_BOOST = 0;
export const DEFAULT_BREATH_SALIENCE_WEIGHT = 0.1;
export const DEFAULT_NATIVE_LIVE_CONTEXT_TIME_ZONE = "Asia/Shanghai";

export const DEFAULT_SUBJECT_STATE_BACKGROUND_MAINTENANCE_CONFIG:
  SubjectStateBackgroundMaintenanceConfig = {};

export const DEFAULT_MIND_LOOP_CONFIG: MindLoopConfig = {
  assemblyVersion: "assembly-v3",
  promptContractVersion: "prompt-v6",
  contextTimeZone: DEFAULT_NATIVE_LIVE_CONTEXT_TIME_ZONE,
  ruleVersion: "mind-v2",
  processVersion: "subject-write-v2",
  breathLimit: 4,
  breathCooldownHours: 0,
  breathSalienceWeight: DEFAULT_BREATH_SALIENCE_WEIGHT,
  breathRecallSalienceBoost: DEFAULT_BREATH_RECALL_SALIENCE_BOOST,
  breathSemanticWeight: 0.65,
  breathSemanticMinScore: 0.80,
  breathMinimumScore: 0.08,
  breathSemanticMedianMargin: 0.03,
  breathRecentRecallPenalty: true,
  breathDiversityMaxTokenOverlap: 0.75,
  breathSemanticCandidateLimit: 256,
  breathSemanticCandidateMaxChars: 2_000,
  maxContextItems: 16,
  maxContextChars: 8_000,
};

export function createDefaultBackendMindRuntime(
  db: Database,
  memoryLifecyclePolicy?: MemoryLifecyclePolicy,
  breathRanking: {
    salienceWeight: number;
  } = {
    salienceWeight: DEFAULT_BREATH_SALIENCE_WEIGHT,
  },
): DefaultNativeLiveBackendMindRuntime {
  const conversations = new DrizzleNativeLiveConversationRepository(db);
  const subjectState = new DrizzleSubjectStateRuntimePort(db);
  const loop = new NativeLiveMindLoopService(
    subjectState,
    {
      ...DEFAULT_MIND_LOOP_CONFIG,
      breathSalienceWeight: breathRanking.salienceWeight,
      ...(memoryLifecyclePolicy ? { memoryLifecyclePolicy } : {}),
    },
    null,
  );
  const mind = new DefaultNativeLiveMindRuntime(loop, {
    subjectId: DEFAULT_NATIVE_LIVE_SUBJECT_ID,
  });
  const contextLineage = new DrizzleNativeLiveContextLineageReader(db);
  return new DefaultNativeLiveBackendMindRuntime(
    conversations,
    mind,
    contextLineage,
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
    decayPolicy
      ? {
          decay: new MemoryLifecycleService(
            new DrizzleMemoryLifecycleRuntimePort(db),
            decayPolicy,
          ),
        }
      : {},
    decayPolicy
      ? {
          decay: {
            priority: DEFAULT_BACKGROUND_TARGET_PLANS.decay.priority,
            cost: DEFAULT_BACKGROUND_TARGET_PLANS.decay.cost,
          },
        }
      : DEFAULT_SUBJECT_STATE_BACKGROUND_MAINTENANCE_CONFIG,
  );
}
