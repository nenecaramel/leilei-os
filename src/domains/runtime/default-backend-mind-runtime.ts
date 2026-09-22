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
} from "./drive-evolution.js";
import {
  DrizzleDriveEvolutionRuntimePort,
} from "./drive-evolution-runtime-repository.js";
import {
  ThoughtEvolutionService,
} from "./thought-evolution.js";
import {
  DrizzleThoughtEvolutionRuntimePort,
} from "./thought-evolution-runtime-repository.js";

type Database = ReturnType<typeof createDatabase>["db"];

export const DEFAULT_NATIVE_LIVE_SUBJECT_ID = "G";

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
      maxContextItems: 16,
      maxContextChars: 8_000,
    },
    null,
  );
  const driveEvolution = new DriveEvolutionService(
    new DrizzleDriveEvolutionRuntimePort(db),
    {
      basePressure: 0.4,
      reinforcementBoost: 0.2,
      activeThreshold: 0.1,
      minEvolutionIntervalHours: 6,
      maxReinforcementSources: 16,
    },
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
  const mind = new DefaultNativeLiveMindRuntime(loop, {
    subjectId: DEFAULT_NATIVE_LIVE_SUBJECT_ID,
    driveEvolution,
    thoughtEvolution,
  });
  return new DefaultNativeLiveBackendMindRuntime(conversations, mind);
}
