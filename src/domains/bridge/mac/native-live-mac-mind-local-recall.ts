import { z } from "zod";
import { breathLexicalScore } from "../../runtime/breath/breath-recall.js";
import type { BreathSemanticScorer } from "../../runtime/breath/breath-semantic-recall.js";
import { chooseMindComparison } from "./native-live-mac-mind-comparison.js";
import { untilAborted, type NativeLiveMacMindLibrary } from "./native-live-mac-mind-library.js";

const uuid = z.guid();
/** The Hook's own recall request, unchanged; the Mac adds its choice before forwarding it. */
export const mindLocalRecallInputSchema = z.object({
  session_id: z.string().min(1).max(256),
  query: z.string().min(1).max(16_000),
  exclude_ids: z.array(uuid).max(20_000),
  caller: z.literal("claude_code"),
  context_epoch: z.number().int().min(0).max(2147483647),
  receipt_mode: z.literal("signed_v1"),
}).strict();
export type MindLocalRecallInput = z.infer<typeof mindLocalRecallInputSchema>;

const answerSchema = z.object({
  success: z.literal(true),
  data: z.looseObject({
    context: z.string().max(50_000),
    memory_ids: z.array(uuid).max(4),
    semantic_mode: z.literal("snapshot_v1"),
  }),
});

/**
 * Recall chosen on the Mac with the rule the owner picked in the 2026-11-28 blind
 * review (the trial rule: 0.8 floor, 0.04 above the prompt's median, at most two).
 * The server still renders the context and signs the receipt, and it honors the
 * choice only when the library version matches its current records, so a deleted,
 * edited or hidden memory can never be delivered from a stale copy. Any doubt
 * returns null and the Hook takes its existing path.
 */
export class NativeLiveMacMindLocalRecall {
  constructor(private readonly options: {
    library: NativeLiveMacMindLibrary;
    scorer: BreathSemanticScorer;
    baseUrl: string;
    token: string;
    fetch?: typeof fetch;
  }) {}

  async recall(input: MindLocalRecallInput, limits: {timeoutMs?: number} = {}): Promise<Record<string, unknown> | null> {
    const library = this.options.library.current();
    if (!library) { this.options.library.refresh(); return null; }
    try {
      const excluded = new Set(input.exclude_ids);
      const eligible = library.memories.filter(memory => !excluded.has(memory.stateId));
      const scores = eligible.length ? await this.options.scorer.score({
        query: input.query,
        candidates: eligible.map(memory => ({...memory, kind: "memory" as const})),
      }) : new Map<string, number>();
      const rows = eligible.map(memory => ({
        id: memory.stateId,
        sem: scores.get(memory.stateId) ?? 0,
        lex: breathLexicalScore(input.query, memory.text),
      }));
      const chosen = chooseMindComparison(rows);
      const signal = AbortSignal.any([this.options.library.signal, AbortSignal.timeout(limits.timeoutMs ?? 1500)]);
      const response = await untilAborted(signal, (this.options.fetch ?? fetch)(`${this.options.baseUrl}/internal/mind/recall`, {
        method: "POST", redirect: "error", signal,
        headers: {authorization: `Bearer ${this.options.token}`, "content-type": "application/json"},
        body: JSON.stringify({
          ...input,
          semantic_snapshot_version: library.version,
          snapshot_scores: Object.fromEntries(chosen.map(id => [id, scores.get(id) ?? 0])),
        }),
      }));
      if (!response.ok) { await response.body?.cancel(); return null; }
      const parsed = answerSchema.safeParse(await untilAborted(signal, response.json() as Promise<unknown>));
      if (!parsed.success) {
        // The server answers in legacy mode when our version is stale: reload, never use it.
        this.options.library.refresh();
        return null;
      }
      return parsed.data.data;
    } catch {
      return null;
    }
  }
}
