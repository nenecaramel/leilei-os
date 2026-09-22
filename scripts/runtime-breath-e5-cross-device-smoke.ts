import assert from "node:assert/strict";
import {
  NativeLiveMacDaemonLoop,
  type NativeLiveMacDaemonRelayClient,
  type NativeLivePreparedCommandExecutor,
} from "../src/domains/bridge/native-live-mac-daemon-loop.js";
import { LocalE5BreathSemanticScorer } from "../src/domains/runtime/local-e5-embedding.js";

const listenerInstanceId = crypto.randomUUID();
const reservationId = crypto.randomUUID();
let submittedScores: Record<string, number> | null = null;

const relay: NativeLiveMacDaemonRelayClient = {
  async renewLease() {
    return "acquired";
  },
  async reserveSemanticScoring() {
    return {
      reservationId,
      query: "solo travel made me feel independent",
      candidates: [
        {
          stateId: "travel-related",
          kind: "memory",
          text: "那趟独自旅行让我第一次真切感到自己可以照顾好自己",
        },
        {
          stateId: "food",
          kind: "memory",
          text: "晚饭吃了炸鸡，第二天又想吃甜点",
        },
        {
          stateId: "database",
          kind: "memory",
          text: "数据库迁移完成后所有集成测试都通过了",
        },
      ],
    };
  },
  async submitSemanticScores(input) {
    submittedScores = input.scores;
  },
  async submitSemanticFallback() {
    throw new Error("E5 cross-device smoke unexpectedly fell back.");
  },
  async reserveNext() {
    return null;
  },
  async markExecutionStarted() {},
  async submitResult() {},
  async markResultDeliveryUnknown() {},
  async rejectReservation() {},
};

const executor: NativeLivePreparedCommandExecutor = {
  async execute() {
    throw new Error("Claude must not execute in semantic-only smoke.");
  },
};

const loop = new NativeLiveMacDaemonLoop(
  listenerInstanceId,
  relay,
  executor,
  new LocalE5BreathSemanticScorer(),
);

const outcome = await loop.runOnce();
assert.deepEqual(outcome, {
  outcome: "semantic_completed",
  reservationId,
});
assert.ok(submittedScores);
const scores = submittedScores as Record<string, number>;
assert.ok(scores["travel-related"] !== undefined);
assert.ok(scores.food !== undefined);
assert.ok(scores.database !== undefined);
assert.ok(scores["travel-related"]! > scores.food!);
assert.ok(scores["travel-related"]! > scores.database!);

process.stdout.write(
  JSON.stringify({
    status: "accepted",
    provider: "multilingual_e5_small_q8",
    path: "mac_e5_to_http_semantic_callback",
    selectedStateId: "travel-related",
    scores,
  }, null, 2) + "\n",
);
