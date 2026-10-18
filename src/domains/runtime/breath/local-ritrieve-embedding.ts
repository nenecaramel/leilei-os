import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BreathSemanticCandidate, BreathSemanticScorer } from "./breath-semantic-recall.js";

const MAX_REPLY_CHARS = 100_000;
const MAX_CANDIDATES = 256;

export type LocalRitrieveOptions = {
  executable?: string;
  workerPath?: string;
  requestTimeoutMs?: number;
  /** Volatile embedding reuse only; no saved snapshots or Railway sync. */
  passageCacheEntries?: number;
};
type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type RitrieveSearchResult = {
  version: string;
  count: number;
  floor?: number;
  hits: Array<{stateId: string; score: number}>;
};

export function defaultRitrievePython(): string {
  return join(homedir(), ".cache", "leileios", "ritrieve-venv", "bin", "python");
}

export function defaultRitrieveWorkerPath(): string {
  return fileURLToPath(new URL("../../../../scripts/mind-ritrieve-worker.py", import.meta.url));
}

/** Single offline worker shared by the daemon's Native Live scorer and Mind Hook search index. */
export class LocalRitrieveBreathSemanticScorer implements BreathSemanticScorer {
  private worker: ChildProcessWithoutNullStreams | null = null;
  private responseBuffer = "";
  private readonly pending = new Map<string, PendingRequest>();
  private snapshotReady = false;

  constructor(private readonly options: LocalRitrieveOptions = {}) {}

  async warmup(): Promise<void> {
    await this.score({query: "语义模型准备完成",
      candidates: [{stateId: "warmup", kind: "memory", text: "语义模型已经启动"}]});
  }

  async score(input: {
    query: string;
    candidates: readonly BreathSemanticCandidate[];
  }): Promise<ReadonlyMap<string, number>> {
    if (!input.query.trim() || input.candidates.length === 0) return new Map();
    if (input.candidates.length > MAX_CANDIDATES) {
      throw new Error("Ritrieve candidate limit exceeded.");
    }
    if (input.candidates.some(c => !c.text.trim() || c.text.length > 2_000)) {
      throw new Error("Ritrieve candidate text is invalid.");
    }
    const data = await this.send({op: "score", query: input.query,
      passages: input.candidates.map(c => c.text)});
    if (!Array.isArray(data.scores) || data.scores.length !== input.candidates.length ||
      !data.scores.every(x => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1)) {
      throw new Error("Ritrieve returned invalid semantic scores.");
    }
    const scores = data.scores as number[];
    return new Map(input.candidates.map((candidate, i) => [candidate.stateId, scores[i]!]));
  }

  /** Build off-path; only commit switches the active local snapshot. */
  async replaceSnapshot(input: {
    version: string;
    memories: readonly {stateId: string; text: string}[];
  }): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(input.version) ||
      input.memories.length > 30_000 ||
      input.memories.some(m => !m.stateId || !m.text.trim() || m.text.length > 2_000) ||
      new Set(input.memories.map(m => m.stateId)).size !== input.memories.length) {
      throw new Error("Invalid Mind snapshot.");
    }
    this.snapshotReady = false;
    await this.requireOk({op: "begin", version: input.version});
    for (let offset = 0; offset < input.memories.length; offset += 64) {
      const rows = input.memories.slice(offset, offset + 64).map(m => [m.stateId, m.text]);
      await this.requireOk({op: "append", version: input.version, rows});
    }
    await this.requireOk({op: "commit", version: input.version});
    this.snapshotReady = true;
  }

  isSnapshotReady(): boolean { return this.snapshotReady; }

  async searchSnapshot(query: string, limit = 48): Promise<RitrieveSearchResult> {
    if (!this.snapshotReady || !query.trim() || !Number.isInteger(limit) || limit < 1 || limit > 48) {
      throw new Error("Mind semantic index unavailable.");
    }
    const data = await this.send({op: "search", query, limit});
    if (!/^[a-f0-9]{64}$/.test(String(data.version)) || !Array.isArray(data.hits) ||
      (typeof data.count !== "number" || !Number.isInteger(data.count)) || (data.count as number) < 0 ||
      (data.floor !== undefined && (typeof data.floor !== "number" ||
        !Number.isFinite(data.floor) || data.floor < 0 || data.floor > 1)) ||
      data.hits.length > limit || !data.hits.every(hit => Array.isArray(hit) &&
        hit.length === 2 && typeof hit[0] === "string" &&
        typeof hit[1] === "number" && Number.isFinite(hit[1]) && hit[1] >= 0 && hit[1] <= 1)) {
      throw new Error("Invalid Mind semantic search response.");
    }
    return {version: data.version as string, count: data.count as number,
      ...(data.floor !== undefined ? {floor: data.floor as number} : {}),
      hits: data.hits.map((hit: unknown) => {
        const row = hit as [string, number];
        return {stateId: row[0], score: row[1]};
      })};
  }

  async close(): Promise<void> {
    this.failWorker(new Error("Ritrieve worker stopped."));
  }

  private async requireOk(body: Record<string, unknown>): Promise<void> {
    const result = await this.send(body);
    if (result.ok !== true) throw new Error("Ritrieve index update failed.");
  }

  private send(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const timeout = this.options.requestTimeoutMs ?? 90_000;
    if (!Number.isSafeInteger(timeout) || timeout <= 0) {
      throw new Error("Invalid Ritrieve timeout.");
    }
    const worker = this.ensureWorker();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.failWorker(new Error("Ritrieve worker timed out.")), timeout);
      timer.unref();
      this.pending.set(id, {resolve, reject, timer});
      try {
        worker.stdin.write(JSON.stringify({...body, id}) + "\n", "utf8", error => {
          if (error) this.failWorker(new Error("Ritrieve worker unavailable."));
        });
      } catch {
        this.failWorker(new Error("Ritrieve worker unavailable."));
      }
    });
  }

  private ensureWorker(): ChildProcessWithoutNullStreams {
    if (this.worker) return this.worker;
    const cacheEntries = this.options.passageCacheEntries ?? 512;
    if (!Number.isSafeInteger(cacheEntries) || cacheEntries < 1 || cacheEntries > 4096) {
      throw new Error("Invalid Ritrieve passage cache capacity.");
    }
    const worker = spawn(
      this.options.executable ?? process.env.LEILEI_MIND_RITRIEVE_PYTHON ?? defaultRitrievePython(),
      [this.options.workerPath ?? defaultRitrieveWorkerPath()],
      { stdio: "pipe", env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        LEILEI_MIND_RITRIEVE_CACHE_ENTRIES: String(cacheEntries),
      } },
    );
    this.worker = worker;
    this.snapshotReady = false;
    this.responseBuffer = "";
    worker.stdout.setEncoding("utf8");
    worker.stdout.on("data", (chunk: string) => {
      if (this.worker !== worker) return;
      this.responseBuffer += chunk;
      if (this.responseBuffer.length > MAX_REPLY_CHARS) {
        this.failWorker(new Error("Ritrieve response too large."));
        return;
      }
      let newline = this.responseBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = this.responseBuffer.slice(0, newline);
        this.responseBuffer = this.responseBuffer.slice(newline + 1);
        this.receive(line);
        newline = this.responseBuffer.indexOf("\n");
      }
    });
    // Discard diagnostics to avoid logging private text.
    worker.stderr.resume();
    worker.once("error", () => {
      if (this.worker === worker) this.failWorker(new Error("Ritrieve executable unavailable."));
    });
    worker.once("exit", () => {
      if (this.worker === worker) this.failWorker(new Error("Ritrieve worker exited."));
    });
    return worker;
  }

  private receive(line: string): void {
    let parsed: unknown;
    try { parsed = JSON.parse(line); }
    catch { this.failWorker(new Error("Ritrieve returned invalid JSON.")); return; }
    if (!parsed || typeof parsed !== "object" || !("id" in parsed) || typeof parsed.id !== "string") {
      this.failWorker(new Error("Ritrieve returned an invalid reply."));
      return;
    }
    const pending = this.pending.get(parsed.id);
    if (!pending) return;
    this.pending.delete(parsed.id);
    clearTimeout(pending.timer);
    if ("error" in parsed) {
      pending.reject(new Error("Ritrieve worker operation unavailable."));
      return;
    }
    pending.resolve(parsed as Record<string, unknown>);
  }

  private failWorker(error: Error): void {
    const worker = this.worker;
    this.worker = null;
    this.responseBuffer = "";
    this.snapshotReady = false;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    if (worker) {
      worker.stdout.removeAllListeners("data");
      worker.kill();
    }
  }
}
