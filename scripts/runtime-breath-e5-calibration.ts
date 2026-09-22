import { LocalE5BreathSemanticScorer } from "../src/domains/runtime/local-e5-embedding.js";

const scorer = new LocalE5BreathSemanticScorer();

const probes = [
  {
    name: "travel",
    query: "一个人出远门以后觉得自己更独立了",
    relevantId: "travel-related",
    candidates: [
      { stateId: "travel-related", kind: "memory" as const, text: "那次独自旅行让我第一次真切感到自己可以照顾好自己" },
      { stateId: "travel-db", kind: "memory" as const, text: "数据库迁移完成后所有集成测试都通过了" },
      { stateId: "travel-food", kind: "memory" as const, text: "晚饭吃了炸鸡，第二天又想吃甜点" },
      { stateId: "travel-ui", kind: "memory" as const, text: "前端导航需要把设置页和聊天页分开" },
    ],
  },
  {
    name: "memory-runtime",
    query: "为什么旧分支里的记忆以后不能再被想起来",
    relevantId: "memory-related",
    candidates: [
      { stateId: "memory-related", kind: "memory" as const, text: "Retry 或 Edit 让旧路径失效后，那条路径产生的长期状态也必须失效，后续召回不能继续使用" },
      { stateId: "memory-food", kind: "memory" as const, text: "甜品放久以后口感会变差" },
      { stateId: "memory-layout", kind: "memory" as const, text: "iOS 页面底部工具栏后来改成了四个入口" },
      { stateId: "memory-build", kind: "memory" as const, text: "一次构建失败是因为 TypeScript 类型收窄没有通过" },
    ],
  },
  {
    name: "emotion",
    query: "聊到那件事的时候心里有点难受",
    relevantId: "emotion-related",
    candidates: [
      { stateId: "emotion-related", kind: "feel" as const, text: "那段对话让我有些难过，之后很久都没有完全散掉" },
      { stateId: "emotion-db", kind: "memory" as const, text: "PostgreSQL transaction 使用 CAS 防止并发重复提交" },
      { stateId: "emotion-ui", kind: "memory" as const, text: "聊天输入框需要支持附件和流式状态" },
      { stateId: "emotion-routine", kind: "memory" as const, text: "下午把桌面文件整理进了几个文件夹" },
    ],
  },
  {
    name: "food",
    query: "最近又特别想吃蛋糕一类的东西",
    relevantId: "food-related",
    candidates: [
      { stateId: "food-related", kind: "memory" as const, text: "比起薯片之类的零食，更容易对甜品和糕点产生兴趣" },
      { stateId: "food-runtime", kind: "memory" as const, text: "Context Manifest 会记录这一轮实际选进模型上下文的状态" },
      { stateId: "food-travel", kind: "memory" as const, text: "那趟旅行需要提前确认机场到酒店的交通方式" },
      { stateId: "food-code", kind: "memory" as const, text: "测试夹具里的中文单字重合会让 lexical channel 命中" },
    ],
  },
] as const;

const results = [];
for (const probe of probes) {
  const scores = await scorer.score({
    query: probe.query,
    candidates: probe.candidates,
  });
  const ranking = probe.candidates
    .map((candidate) => ({
      stateId: candidate.stateId,
      score: scores.get(candidate.stateId) ?? 0,
    }))
    .sort((a, b) => b.score - a.score);

  const relevant = ranking.find((item) => item.stateId === probe.relevantId);
  const top1 = ranking[0] ?? null;
  const runnerUp = ranking[1] ?? null;
  results.push({
    name: probe.name,
    passed: top1?.stateId === probe.relevantId,
    expectedTop1: probe.relevantId,
    actualTop1: top1?.stateId ?? null,
    relevant: relevant?.score ?? null,
    top1Score: top1?.score ?? null,
    top1Margin:
      top1 && runnerUp ? top1.score - runnerUp.score : null,
    ranking,
  });
}

const passCount = results.filter((result) => result.passed).length;
process.stdout.write(
  JSON.stringify({
    status: passCount === results.length ? "accepted" : "rejected",
    provider: "multilingual_e5_small_q8",
    probeCount: results.length,
    passCount,
    failCount: results.length - passCount,
    results,
  }, null, 2) + "\n",
);
