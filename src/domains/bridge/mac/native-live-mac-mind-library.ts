import { z } from "zod";
import type { BreathSemanticScorer } from "../../runtime/breath/breath-semantic-recall.js";

const uuid = z.guid();
const pageSchema = z.object({
  success: z.literal(true),
  data: z.object({
    version: z.string().regex(/^[a-f0-9]{64}$/),
    total: z.number().int().min(0).max(30_000),
    memories: z.array(z.object({stateId: uuid, text: z.string().min(1).max(2000)})).max(128),
    next_offset: z.number().int().min(1).max(30_000).nullable(),
  }),
});

export type MindMemory = {stateId: string; text: string};
export type MindLibrarySnapshot = {version: string; memories: MindMemory[]; loadedAt: number};

/**
 * The Mac's copy of the recallable Memory library, downloaded through the
 * authenticated snapshot route. It is only a cache: the server checks its
 * version before anything chosen from it is delivered. Loading happens on
 * demand, one at a time, with no timer, polling or startup download.
 */
export class NativeLiveMacMindLibrary {
  private snapshot: MindLibrarySnapshot | null = null;
  private loading: Promise<MindLibrarySnapshot> | null = null;
  private readonly abort = new AbortController();
  private readonly now: () => number;

  constructor(private readonly options: {
    baseUrl: string;
    token: string;
    scorer: BreathSemanticScorer;
    fetch?: typeof fetch;
    now?: () => number;
  }) {
    this.now = options.now ?? Date.now;
  }

  current(): MindLibrarySnapshot | null { return this.snapshot; }

  /** Starts a load unless one is running; failures keep the previous copy. */
  refresh(): void { void this.load().catch(() => undefined); }

  load(): Promise<MindLibrarySnapshot> {
    this.loading ??= this.loadOnce().finally(() => { this.loading = null; });
    return this.loading;
  }

  async idle(): Promise<void> { await this.loading?.catch(() => undefined); }

  async close(): Promise<void> {
    this.abort.abort();
    await this.idle();
  }

  get signal(): AbortSignal { return this.abort.signal; }

  private async loadOnce(): Promise<MindLibrarySnapshot> {
    let library: MindLibrarySnapshot;
    try { library = await this.fetchLibrary(); }
    catch (error) {
      if (this.abort.signal.aborted) throw error;
      library = await this.fetchLibrary(); // Version changed between pages, or a transient failure.
    }
    // Small batches keep the shared scorer available to a real /score.
    for (let index = 0; index < library.memories.length; index += 8) {
      if (this.abort.signal.aborted) throw new Error("Stopped.");
      await this.options.scorer.score({
        query: "library",
        candidates: library.memories.slice(index, index + 8).map(memory => ({...memory, kind: "memory" as const})),
      });
    }
    if (this.abort.signal.aborted) throw new Error("Stopped.");
    this.snapshot = library;
    return library;
  }

  private async fetchLibrary(): Promise<MindLibrarySnapshot> {
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(20_000)]);
    const memories: MindMemory[] = [];
    const seen = new Set<string>();
    let version: string | null = null;
    let offset = 0;
    for (;;) {
      const response = await untilAborted(signal, (this.options.fetch ?? fetch)(
        `${this.options.baseUrl}/internal/mind/snapshot?offset=${offset}`,
        {redirect: "error", signal, headers: {authorization: `Bearer ${this.options.token}`}},
      ));
      if (!response.ok) { await response.body?.cancel(); throw new Error("Snapshot unavailable."); }
      const {data} = pageSchema.parse(await untilAborted(signal, response.json() as Promise<unknown>));
      if (version !== null && version !== data.version) throw new Error("Snapshot changed.");
      version = data.version;
      for (const memory of data.memories) {
        if (seen.has(memory.stateId)) throw new Error("Snapshot repeated a record.");
        seen.add(memory.stateId);
        memories.push(memory);
      }
      if (data.next_offset === null) {
        if (memories.length !== data.total) throw new Error("Snapshot incomplete.");
        return {version, memories, loadedAt: this.now()};
      }
      if (data.next_offset <= offset) throw new Error("Snapshot did not advance.");
      offset = data.next_offset;
    }
  }
}

export function untilAborted<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new Error("Stopped."));
    if (signal.aborted) { stop(); return; }
    signal.addEventListener("abort", stop, {once: true});
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}
