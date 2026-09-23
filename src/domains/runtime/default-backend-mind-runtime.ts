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

type Database = ReturnType<typeof createDatabase>["db"];

export const DEFAULT_NATIVE_LIVE_SUBJECT_ID = "G";

export const DEFAULT_DRIVE_EVOLUTION_POLICY: DriveEvolutionPolicy = {
  basePressure: 0.4,
  reinforcementBoost: 0.2,
  activeThreshold: 0.1,
  minEvolutionIntervalHours: 6,
  maxReinforcementSources: 16,
};

export function createDefaultBackendMindRuntime(
  db: Database,
): DefaultNativeLiveBackendMindRuntime {
  const conversations = new DrizzleNativeLiveConversationRepository(db);
  const subjectState = new DrizzleSubjectStateRuntimePort(db);
  const loop = new NativeLiveMindLoopService(
    subjectState,
    {
      assemblyVersion: "assembly-v1",
      promptContractVersion: "prompt-v1",
      ruleVersion: "mind-v1",
      processVersion: "subject-write-v1",
      surfaceLimit: 8,
      breathLimit: 4,
      breathCooldownHours: 0,
      breathSalienceWeight: 0,
      breathSemanticWeight: 0.65,
      breathSemanticMinScore: 0.80,
      breathSemanticCandidateLimit: 64,
      breathSemanticCandidateMaxChars: 2_000,
      driveLimit: 3,
      fixationLimit: 3,
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
    {
      flitHalfLifeHours: 168,
      baseStrength: 0.35,
      reinforcementBoost: 0.25,
      fixationThreshold: 0.75,
      minEvolutionIntervalHours: 6,
      maxReinforcementSources: 16,
    },
  );
  const topicEvolution = new TopicEvolutionService(
    new DrizzleTopicEvolutionRuntimePort(db),
    {
      maxReinforcementSources: 16,
    },
  );
  const mind = new DefaultNativeLiveMindRuntime(loop, {
    subjectId: DEFAULT_NATIVE_LIVE_SUBJECT_ID,
    driveEvolution,
    thoughtEvolution,
    topicEvolution,
  });
  return new DefaultNativeLiveBackendMindRuntime(conversations, mind);
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
