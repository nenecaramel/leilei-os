import type { BreathSemanticCandidate } from "../breath/breath-semantic-recall.js";
import { LocalE5BreathSemanticScorer } from "../breath/local-e5-embedding.js";
import { LocalRitrieveBreathSemanticScorer } from "../breath/local-ritrieve-embedding.js";
import { selectHybridMindCandidatesConditional } from "./mind-hybrid-candidates.js";

// Per-request candidate bound; NEVER a ceiling on stored Memory.
const MAX_CANDIDATES_PER_TURN = 256;

/**
 * Claude-only, read-only model scorer. It receives a subset of eligible
 * candidates from Railway for ONE prompt. It never owns the Memory database,
 * downloads complete snapshots, runs a poller, or requests Railway itself.
 */
export class LocalHybridMindRecallScorer {
  constructor(
    private readonly e5: Pick<LocalE5BreathSemanticScorer, "score"> =
      new LocalE5BreathSemanticScorer(),
    private readonly ritrieve: Pick<LocalRitrieveBreathSemanticScorer,
      "score" | "warmup" | "close"> = new LocalRitrieveBreathSemanticScorer(),
  ) {}

  async warmup(): Promise<void> {
    await Promise.all([
      this.ritrieve.warmup(),
      this.e5.score({query:"语义模型准备完成",
        candidates:[{stateId:"warmup",kind:"memory",text:"语义模型已经启动"}]}),
    ]);
  }

  async scoreCandidatesHybrid(input: {
    query: string;
    candidates: readonly BreathSemanticCandidate[];
  }): Promise<{selectedIds: string[]}> {
    if (!input.query.trim() || input.candidates.length < 1 ||
        input.candidates.length > MAX_CANDIDATES_PER_TURN ||
        new Set(input.candidates.map(c => c.stateId)).size !== input.candidates.length ||
        input.candidates.some(c=>c.kind!=="memory" || !c.text.trim() || c.text.length>2000))
      throw new Error("Invalid on-demand Mind candidate set.");

    const [e5Scores, ritScores] = await Promise.all([
      this.e5.score(input), this.ritrieve.score(input),
    ]);
    const ranked = (scores: ReadonlyMap<string, number>) => input.candidates
      .map(c => {
        const score = scores.get(c.stateId);
        if (score === undefined || !Number.isFinite(score) || score < 0 || score > 1)
          throw new Error("Incomplete on-demand Mind scores.");
        return {stateId:c.stateId,score};
      })
      .sort((a,b)=>b.score-a.score || a.stateId.localeCompare(b.stateId));
    const selected = selectHybridMindCandidatesConditional({
      query:input.query,mode:"agreement",
      memories:input.candidates.map(c=>({stateId:c.stateId,text:c.text})),
      e5Ranked:ranked(e5Scores),ritrieveRanked:ranked(ritScores),
    });
    return {selectedIds:selected.map(c=>c.stateId)};
  }

  async close(): Promise<void> {
    await this.ritrieve.close();
  }
}
