import type { createDatabase } from "../../database/client.js";
import type {
  NativeLiveClaudeRuntime,
} from "../conversation/native-live-conversation-orchestrator.js";
import {
  ClaudeCodeTopicResurfaceDeliberator,
} from "./claude-code-topic-resurface-deliberator.js";
import {
  ClaudeCodeTopicResurfaceEvaluator,
} from "./claude-code-topic-resurface-evaluator.js";
import {
  ClaudeCodeTopicResurfaceRetentionEvaluator,
} from "./claude-code-topic-resurface-retention-evaluator.js";
import {
  DrizzleTopicResurfaceCandidatePort,
} from "./topic-resurface-candidate-runtime-repository.js";
import {
  TopicResurfaceCandidateService,
} from "./topic-resurface-candidates.js";
import {
  TopicResurfaceEvaluationService,
} from "./topic-resurface-evaluation.js";
import {
  TopicResurfaceInternalLoopService,
} from "./topic-resurface-internal-loop.js";
import {
  TopicResurfaceRetentionGateService,
} from "./topic-resurface-retention-gate.js";
import {
  DrizzleTopicResurfaceThoughtMaterializationPort,
} from "./topic-resurface-thought-materialization-runtime-repository.js";
import {
  TopicResurfaceThoughtMaterializationService,
  type TopicResurfaceThoughtMaterializationConfig,
} from "./topic-resurface-thought-materialization.js";

type Database = ReturnType<typeof createDatabase>["db"];
type TopicResurfaceClaudeRuntime = Pick<NativeLiveClaudeRuntime, "sendNew">;

export type TopicResurfaceBackgroundPipelineConfig =
  TopicResurfaceThoughtMaterializationConfig;

export function createTopicResurfaceBackgroundPipeline(input: {
  db: Database;
  runtime: TopicResurfaceClaudeRuntime;
  config: TopicResurfaceBackgroundPipelineConfig;
}): TopicResurfaceThoughtMaterializationService {
  const candidates = new TopicResurfaceCandidateService(
    new DrizzleTopicResurfaceCandidatePort(input.db),
  );
  const evaluation = new TopicResurfaceEvaluationService(
    candidates,
    new ClaudeCodeTopicResurfaceEvaluator(input.runtime),
  );
  const internalLoop = new TopicResurfaceInternalLoopService(
    evaluation,
    new ClaudeCodeTopicResurfaceDeliberator(input.runtime),
  );
  const retention = new TopicResurfaceRetentionGateService(
    internalLoop,
    new ClaudeCodeTopicResurfaceRetentionEvaluator(input.runtime),
  );

  return new TopicResurfaceThoughtMaterializationService(
    retention,
    new DrizzleTopicResurfaceThoughtMaterializationPort(input.db),
    input.config,
  );
}
