import type { BreathSemanticCandidate, BreathSemanticScorer } from "../breath/breath-semantic-recall.js";
import type { RitrieveSearchResult } from "../breath/local-ritrieve-embedding.js";
import { LocalE5BreathSemanticScorer } from "../breath/local-e5-embedding.js";
import { LocalRitrieveBreathSemanticScorer } from "../breath/local-ritrieve-embedding.js";
import { selectHybridMindCandidatesConditional } from "./mind-hybrid-candidates.js";

const MAX_HYBRID_MEMORIES = 256;
const E5_BATCH = 64;

export type HybridRecallSearchResult = RitrieveSearchResult;

/**
 * Opt-in live LOCAL experiment. A matching remote Mind snapshot is still
 * authenticated and version-checked by Railway before ANY memory is used.
 *
 * Safety/performance bound: unlike the all-vector-indexed ritrieve model, the
 * E5 scorer only caches 512 passages. Refuse hybrid queries beyond 256 Memory
 * records rather than silently approximate full-corpus E5 rank and misrepresent
 * the offline algorithm. Native Live keeps its existing E5 scorer.
 */
export class LocalHybridMindRecallScorer implements BreathSemanticScorer {
  private active: {version: string; memories: Array<{stateId: string; text: string}>} | null = null;

  constructor(
    private readonly e5: Pick<LocalE5BreathSemanticScorer,"score"> = new LocalE5BreathSemanticScorer(),
    private readonly ritrieve: Pick<LocalRitrieveBreathSemanticScorer,
      "score"|"warmup"|"replaceSnapshot"|"isSnapshotReady"|"searchSnapshot"|"close"> =
        new LocalRitrieveBreathSemanticScorer(),
  ) {}

  score(input: {query: string; candidates: readonly BreathSemanticCandidate[]}): Promise<ReadonlyMap<string,number>> {
    return this.e5.score(input);
  }

  async warmup(): Promise<void> {
    await Promise.all([
      this.ritrieve.warmup(),
      this.e5.score({query:"语义模型准备完成",
        candidates:[{stateId:"warmup",kind:"memory",text:"语义模型已经启动"}]}),
    ]);
  }

  isSnapshotReady(): boolean {
    return this.active !== null && this.ritrieve.isSnapshotReady();
  }

  async replaceSnapshot(input: {
    version: string;
    memories: readonly {stateId: string; text: string}[];
  }): Promise<void> {
    // Fail closed if snapshot changes during in-flight hybrid search.
    this.active = null;
    if (input.memories.length > MAX_HYBRID_MEMORIES) {
      throw new Error("Full-corpus E5 hybrid unavailable above bounded size.");
    }
    await this.ritrieve.replaceSnapshot(input);
    // Precompute E5 passages before exposing the new version. Otherwise the
    // first user prompt could spend the entire Hook budget encoding its corpus.
    for (let offset=0;offset<input.memories.length;offset+=E5_BATCH) {
      const group=input.memories.slice(offset,offset+E5_BATCH);
      const scored=await this.e5.score({query:"语义模型准备完成",
        candidates:group.map(m=>({stateId:m.stateId,text:m.text,kind:"memory" as const}))});
      if (scored.size!==group.length
          || group.some(m=>!Number.isFinite(scored.get(m.stateId))))
        throw new Error("Incomplete local E5 snapshot preparation.");
    }
    this.active = {version:input.version,memories:input.memories.map(x=>({...x}))};
  }

  async searchSnapshot(query: string, limit: number): Promise<RitrieveSearchResult> {
    return this.ritrieve.searchSnapshot(query,limit);
  }

  async searchHybrid(query: string): Promise<HybridRecallSearchResult> {
    const snapshot=this.active;
    if (!snapshot || !this.isSnapshotReady() || !query.trim())
      throw new Error("Hybrid Mind snapshot unavailable.");
    const indexed=await this.ritrieve.searchSnapshot(query,48);
    if (indexed.version!==snapshot.version || indexed.count!==snapshot.memories.length)
      throw new Error("Hybrid Mind snapshot changed.");
    const rankedE5: Array<{stateId:string;score:number}>=[];
    for(let offset=0;offset<snapshot.memories.length;offset+=E5_BATCH){
      const rows=snapshot.memories.slice(offset,offset+E5_BATCH);
      const scores=await this.e5.score({query,candidates:rows.map(m=>({
        stateId:m.stateId,text:m.text,kind:"memory" as const,
      }))});
      for(const row of rows){
        const score=scores.get(row.stateId);
        if (score===undefined || !Number.isFinite(score) || score<0 || score>1)
          throw new Error("Invalid hybrid E5 score.");
        rankedE5.push({stateId:row.stateId,score});
      }
    }
    if (this.active!==snapshot || !this.ritrieve.isSnapshotReady())
      throw new Error("Hybrid snapshot changed during scoring.");
    rankedE5.sort((a,b)=>b.score-a.score || a.stateId.localeCompare(b.stateId));
    const selected=selectHybridMindCandidatesConditional({
      query,mode:"agreement",memories:snapshot.memories,
      e5Ranked:rankedE5,
      ritrieveRanked:indexed.hits,
    });
    // Values here are ONLY server-side selection/ranking weights, not
    // original model confidences. Remote verifies snapshot/current eligibility.
    return {version:snapshot.version,count:snapshot.memories.length,
      hits:selected.map((x,i)=>({stateId:x.stateId,score:i===0?0.99:0.98}))};
  }

  async close(): Promise<void> {
    this.active=null;
    await this.ritrieve.close();
  }
}
