import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BreathSemanticCandidate, BreathSemanticScorer } from "./breath-semantic-recall.js";

const MAX_REPLY_CHARS = 100_000;
const MAX_CANDIDATES = 256;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export type LocalRitrieveOptions = {
  executable?: string;
  workerPath?: string;
  requestTimeoutMs?: number;
};

type PendingRequest = {
  resolve: (value: ReadonlyMap<string, number>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  candidates: readonly BreathSemanticCandidate[];
};

export function defaultRitrievePython(): string {
  return join(homedir(), ".cache", "leileios", "ritrieve-venv", "bin", "python");
}

export function defaultRitrieveWorkerPath(): string {
  // Also works when compiled under dist/domains/runtime/breath.
  return fileURLToPath(new URL("../../../../scripts/mind-ritrieve-worker.py", import.meta.url));
}

/**
 * Local, persistent SentenceTransformers sidecar for richinfoai/ritrieve_zh_v1.
 * No Memory text is sent to a hosted API or logged by this adapter.
 * Only the Mac daemon owns the worker; the Hook still connects through the
 * existing owner-only UNIX socket and the canonical Railway receipt path.
 */
export class LocalRitrieveBreathSemanticScorer implements BreathSemanticScorer {
  private worker: ChildProcessWithoutNullStreams | null = null;
  private responseBuffer = "";
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly options: LocalRitrieveOptions = {}) {}

  async warmup(): Promise<void> {
    await this.score({
      query: "语义模型准备完成",
      candidates: [{ stateId: "warmup", kind: "memory", text: "语义模型已经启动" }],
    });
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
    const worker = this.ensureWorker();
    const id = randomUUID();
    const timeout = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeout) || timeout <= 0) {
      throw new Error("Ritrieve request timeout is invalid.");
    }

    return new Promise<ReadonlyMap<string, number>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failWorker(new Error("Ritrieve worker timed out."));
      }, timeout);
      timer.unref();
      this.pending.set(id, {resolve, reject, timer, candidates: input.candidates});
      const request = JSON.stringify({
        id,
        query: input.query,
        passages: input.candidates.map(c => c.text),
      }) + "\n";
      try {
        worker.stdin.write(request, "utf8", error => {
          if (error) this.failWorker(new Error("Ritrieve worker unavailable."));
        });
      } catch {
        this.failWorker(new Error("Ritrieve worker unavailable."));
      }
    });
  }

  async close(): Promise<void> {
    this.failWorker(new Error("Ritrieve worker stopped."));
  }

  private ensureWorker(): ChildProcessWithoutNullStreams {
    if (this.worker) return this.worker;
    const worker = spawn(
      this.options.executable ?? process.env.LEILEI_MIND_RITRIEVE_PYTHON ?? defaultRitrievePython(),
      [this.options.workerPath ?? defaultRitrieveWorkerPath()],
      { stdio: ["pipe", "pipe", "pipe"], env: {...process.env, PYTHONUNBUFFERED: "1"} },
    );
    this.worker = worker;
    this.responseBuffer = "";
    worker.stdout.setEncoding("utf8");
    worker.stdout.on("data", (chunk: string) => {
      if (this.worker !== worker) return;
      this.responseBuffer += chunk;
      if (this.responseBuffer.length > MAX_REPLY_CHARS) {
        this.failWorker(new Error("Ritrieve response exceeded size limit."));
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
    // Drain stderr, but never print model diagnostics or Memory plaintext.
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
    try { parsed = JSON.parse(line); } catch {
      this.failWorker(new Error("Ritrieve returned invalid JSON."));
      return;
    }
    if (!parsed || typeof parsed !== "object" || !("id" in parsed) || typeof parsed.id !== "string") {
      this.failWorker(new Error("Ritrieve returned an invalid reply."));
      return;
    }
    const pending = this.pending.get(parsed.id);
    if (!pending) return;
    this.pending.delete(parsed.id);
    clearTimeout(pending.timer);
    const scores = "scores" in parsed ? parsed.scores : undefined;
    if (!Array.isArray(scores) || scores.length !== pending.candidates.length ||
      !scores.every(x => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1)) {
      pending.reject(new Error("Ritrieve returned invalid semantic scores."));
      return;
    }
    pending.resolve(new Map(pending.candidates.map((c, index) => [c.stateId, scores[index] as number])));
  }

  private failWorker(error: Error): void {
    const worker = this.worker;
    this.worker = null;
    this.responseBuffer = "";
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
