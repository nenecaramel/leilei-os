import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { breathLexicalScore } from "../../runtime/breath/breath-recall.js";
import type { BreathSemanticScorer } from "../../runtime/breath/breath-semantic-recall.js";
import { NativeLiveMacMindLibrary, type MindLibrarySnapshot } from "./native-live-mac-mind-library.js";

const uuid = z.guid();
export const mindComparisonOfferSchema = z.object({
  session: z.string().regex(/^[a-f0-9]{64}$/),
  query: z.string().min(1).max(16_000),
  outcome: z.enum(["delivered", "empty", "failed"]),
  current_ids: z.array(uuid).max(256),
  exclude_ids: z.array(uuid).max(20_000),
  current_ms: z.number().int().min(0).max(60_000),
}).strict();
export type MindComparisonOffer = z.infer<typeof mindComparisonOfferSchema>;

export type MindScoreRow = {id: string; sem: number; lex: number};
type Row = MindScoreRow;

/** Trial policy. The log keeps the top rows so other policies can be replayed offline. */
export const MIND_COMPARISON_POLICY = {semanticFloor: 0.8, medianMargin: 0.04, semanticWeight: 0.65, secondWithin: 0.02, limit: 2} as const;

function combined(row: Row): number {
  return MIND_COMPARISON_POLICY.semanticWeight * row.sem + (1 - MIND_COMPARISON_POLICY.semanticWeight) * row.lex;
}

export function semanticMedian(rows: readonly Row[]): number {
  const ordered = rows.map(row => row.sem).sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length === 0) return 0;
  return ordered.length % 2 === 1 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

export function chooseMindComparison(rows: readonly Row[]): string[] {
  // E5 scores sit close together, so a match must also stand out from this prompt's own middle.
  const floor = rows.length < 8 ? MIND_COMPARISON_POLICY.semanticFloor
    : Math.max(MIND_COMPARISON_POLICY.semanticFloor, semanticMedian(rows) + MIND_COMPARISON_POLICY.medianMargin);
  const ranked = rows.filter(row => row.sem >= floor)
    .sort((a, b) => combined(b) - combined(a));
  const first = ranked[0];
  if (!first) return [];
  return ranked.slice(0, MIND_COMPARISON_POLICY.limit)
    .filter(row => combined(first) - combined(row) <= MIND_COMPARISON_POLICY.secondWithin)
    .map(row => row.id);
}

export function defaultMindComparisonDirectory(): string {
  return join(homedir(), ".leileios", "mind-comparison");
}

/**
 * Trial of a Mac-side recall. Output goes only to a private local log and is never
 * delivered to Claude. Work happens on offers alone: no timers, polling or startup load.
 * Memory text stays in RAM; the log holds the prompt, record ids and scores.
 */
export class NativeLiveMacMindComparison {
  private readonly library: NativeLiveMacMindLibrary;
  private readonly ownsLibrary: boolean;
  private running: Promise<void> | null = null;
  private dropped = 0;
  private stopped = false;
  private readonly abort = new AbortController();
  private readonly now: () => number;

  constructor(private readonly options: {
    /** Shared with the local recall; without it the trial keeps its own copy. */
    library?: NativeLiveMacMindLibrary;
    baseUrl: string;
    token: string;
    scorer: BreathSemanticScorer;
    directory?: string;
    /** Lets the real recall of this turn finish with the shared scorer first. */
    delayMs?: number;
    libraryMaxAgeMs?: number;
    maxLogBytes?: number;
    fetch?: typeof fetch;
    now?: () => number;
  }) {
    this.now = options.now ?? Date.now;
    this.ownsLibrary = !options.library;
    this.library = options.library ?? new NativeLiveMacMindLibrary({
      baseUrl: options.baseUrl, token: options.token, scorer: options.scorer, fetch: options.fetch, now: options.now,
    });
  }

  offer(input: MindComparisonOffer): boolean {
    if (this.stopped) return false;
    if (this.running) { this.dropped += 1; return false; }
    const dropped = this.dropped;
    this.dropped = 0;
    this.running = this.run(input, dropped).catch(() => undefined).finally(() => { this.running = null; });
    return true;
  }

  async idle(): Promise<void> { await this.running; }

  async close(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    await this.running;
    if (this.ownsLibrary) await this.library.close();
  }

  private async run(input: MindComparisonOffer, dropped: number): Promise<void> {
    await this.pause(this.options.delayMs ?? 4_000);
    let result: Record<string, unknown>;
    try {
      result = {status: "compared", ...await this.compare(input)};
    } catch {
      result = {status: "failed"};
    }
    if (this.abort.signal.aborted) return;
    this.append({
      at: new Date(this.now()).toISOString(), session: input.session, query: input.query,
      outcome: input.outcome, current_ids: input.current_ids, current_ms: input.current_ms,
      dropped_before: dropped, ...result,
    });
    const library = this.library.current();
    if (library && !this.stopped
      && this.now() - library.loadedAt > (this.options.libraryMaxAgeMs ?? 600_000)) {
      // Keep the older library when a refresh fails; the next comparison retries.
      await this.library.load().catch(() => undefined);
    }
  }

  private async compare(input: MindComparisonOffer) {
    const library: MindLibrarySnapshot = this.library.current() ?? await this.library.load();
    const excluded = new Set(input.exclude_ids);
    const eligible = library.memories.filter(memory => !excluded.has(memory.stateId));
    const started = performance.now();
    const scores = await this.options.scorer.score({
      query: input.query,
      candidates: eligible.map(memory => ({...memory, kind: "memory" as const})),
    });
    const rows = eligible.map(memory => ({
      id: memory.stateId,
      sem: scores.get(memory.stateId) ?? 0,
      lex: breathLexicalScore(input.query, memory.text),
    }));
    const shadow = chooseMindComparison(rows);
    const round = (value: number) => Math.round(value * 10_000) / 10_000;
    return {
      shadow_ids: shadow,
      shadow_ms: Math.round(performance.now() - started),
      library_size: library.memories.length,
      library_version: library.version,
      library_age_ms: this.now() - library.loadedAt,
      sem_median: round(semanticMedian(rows)),
      policy: MIND_COMPARISON_POLICY,
      top: [...rows].sort((a, b) => combined(b) - combined(a)).slice(0, 10)
        .map(row => ({id: row.id, sem: round(row.sem), lex: round(row.lex)})),
    };
  }

  private pause(ms: number): Promise<void> {
    return new Promise(resolve => {
      const finish = () => { clearTimeout(timer); this.abort.signal.removeEventListener("abort", finish); resolve(); };
      const timer = setTimeout(finish, ms);
      this.abort.signal.addEventListener("abort", finish, {once: true});
    });
  }

  private append(record: Record<string, unknown>): void {
    const line = JSON.stringify(record) + "\n";
    const directory = this.options.directory ?? defaultMindComparisonDirectory();
    let descriptor: number | undefined;
    try {
      mkdirSync(directory, {recursive: true, mode: 0o700});
      const folder = lstatSync(directory);
      if (!folder.isDirectory() || (folder.mode & 0o077) !== 0) throw new Error("Unsafe directory.");
      descriptor = openSync(join(directory, "log.jsonl"),
        constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      const file = fstatSync(descriptor);
      if (!file.isFile() || file.nlink !== 1 || (file.mode & 0o077) !== 0) throw new Error("Unsafe file.");
      if (file.size + Buffer.byteLength(line) > (this.options.maxLogBytes ?? 8 * 1024 * 1024)) {
        this.stopped = true; // A full trial stays as evidence; it is never rotated away.
        return;
      }
      writeSync(descriptor, line);
    } catch { /* The trial must never affect the daemon. */ }
    finally { if (descriptor !== undefined) closeSync(descriptor); }
  }
}
