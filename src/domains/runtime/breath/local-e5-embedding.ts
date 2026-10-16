import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  BreathSemanticCandidate,
  BreathSemanticScorer,
} from "./breath-semantic-recall.js";

const TRANSFORMERS_PACKAGE = "@huggingface/transformers";
const TRANSFORMERS_VERSION = "4.3.0";
const MODEL_ID = "Xenova/multilingual-e5-small";
const PASSAGE_CACHE_LIMIT = 512;
const INTERRUPTIBLE_BATCH_SIZE = 32;

export type LocalE5Options = {
  runtimeRoot?: string;
  modelCacheDir?: string;
  modelId?: string;
  dtype?: "q8" | "fp16" | "fp32";
  progressCallback?: (info: unknown) => void;
  device?: "cpu";
};

export class LocalE5ProviderError extends Error {
  constructor(
    readonly code:
      | "PROVIDER_NOT_PREPARED"
      | "PROVIDER_LOAD_FAILED"
      | "INVALID_EMBEDDING_OUTPUT",
    message: string,
  ) {
    super(message);
    this.name = "LocalE5ProviderError";
  }
}

type Extractor = (
  texts: string[],
  options: {
    pooling: "mean";
    normalize: true;
  },
) => Promise<{ tolist(): unknown }>;

type TransformersModule = {
  pipeline(
    task: "feature-extraction",
    model: string,
    options: {
      dtype: "q8" | "fp16" | "fp32";
      device?: "cpu";
      progress_callback?: (info: unknown) => void;
    },
  ): Promise<Extractor>;
  env: {
    cacheDir: string | null;
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
  };
};

export function defaultLocalE5RuntimeRoot(): string {
  return join(homedir(), ".cache", "leileios", "embedding-runtime-v1");
}

export function defaultLocalE5ModelCacheDir(): string {
  return join(homedir(), ".cache", "leileios", "embedding-models-v1");
}

export function localE5PackageVersion(): string {
  return TRANSFORMERS_VERSION;
}

export function localE5ModelId(): string {
  return MODEL_ID;
}

export class LocalE5BreathSemanticScorer implements BreathSemanticScorer {
  private extractorPromise: Promise<Extractor> | null = null;
  // Hash keys avoid retaining raw Memory text in the cache index.
  // Vectors are process-local, bounded, and tied to this model instance.
  private readonly passageVectors = new Map<string, number[]>();

  constructor(private readonly options: LocalE5Options = {}) {}

  async score(input: {
    query: string;
    candidates: readonly BreathSemanticCandidate[];
    signal?: AbortSignal;
  }): Promise<ReadonlyMap<string, number>> {
    const query = input.query.trim();
    if (!query || input.candidates.length === 0) return new Map();
    if (input.signal?.aborted) throw new Error("E5 scoring aborted.");

    const texts = input.candidates.map((candidate) => candidate.text.trim());
    const keys = texts.map((text) => createHash("sha256").update(text).digest("hex"));
    const missing = new Map<string, string>();
    keys.forEach((key, index) => {
      if (!this.passageVectors.has(key) && !missing.has(key)) {
        missing.set(key, texts[index]!);
      }
    });

    const extractor = await this.getExtractor();
    const uncached = [...missing];
    const batchSize = input.signal
      ? INTERRUPTIBLE_BATCH_SIZE
      : Math.max(1, uncached.length);
    const computed = new Map<string, number[]>();
    let queryVector: number[] | null = null;

    // The socket passes an AbortSignal: split expensive cold requests so a
    // disconnected caller cannot keep the daemon busy for the remaining batches.
    // Direct local callers retain full batching throughput.
    for (let offset = 0; offset < Math.max(1, uncached.length); offset += batchSize) {
      if (input.signal?.aborted) throw new Error("E5 scoring aborted.");
      const batch = uncached.slice(offset, offset + batchSize);
      const batchTexts = [
        ...(queryVector === null ? [`query: ${query}`] : []),
        ...batch.map(([, text]) => `passage: ${text}`),
      ];
      let raw: unknown;
      try {
        raw = (await extractor(batchTexts, {
          pooling: "mean",
          normalize: true,
        })).tolist();
      } catch (error) {
        throw new LocalE5ProviderError(
          "PROVIDER_LOAD_FAILED",
          error instanceof Error ? error.message : String(error),
        );
      }
      const vectors = parseEmbeddingMatrix(raw, batchTexts.length);
      const firstPassage = queryVector === null ? 1 : 0;
      if (queryVector === null) queryVector = vectors[0]!;
      batch.forEach(([key], index) => {
        computed.set(key, vectors[index + firstPassage]!);
      });
    }

    if (input.signal?.aborted) throw new Error("E5 scoring aborted.");
    const scores = new Map<string, number>();
    input.candidates.forEach((candidate, index) => {
      const key = keys[index]!;
      const candidateVector = computed.get(key) ?? this.passageVectors.get(key);
      if (!candidateVector || !queryVector) {
        throw new LocalE5ProviderError(
          "INVALID_EMBEDDING_OUTPUT", "E5 candidate vector is missing.",
        );
      }
      scores.set(candidate.stateId, clamp01(dot(queryVector, candidateVector)));
    });

    // Commit only fully successful requests; edits naturally miss the hash key.
    for (const [key, vector] of computed) this.rememberPassage(key, vector);
    for (const key of keys) {
      const vector = this.passageVectors.get(key);
      if (vector) this.rememberPassage(key, vector);
    }
    return scores;
  }

  private rememberPassage(key: string, vector: number[]): void {
    this.passageVectors.delete(key);
    this.passageVectors.set(key, vector);
    if (this.passageVectors.size > PASSAGE_CACHE_LIMIT) {
      const oldest = this.passageVectors.keys().next().value;
      if (oldest !== undefined) this.passageVectors.delete(oldest);
    }
  }

  private getExtractor(): Promise<Extractor> {
    if (!this.extractorPromise) {
      this.extractorPromise = this.loadExtractor();
    }
    return this.extractorPromise;
  }

  private async loadExtractor(): Promise<Extractor> {
    const runtimeRoot = this.options.runtimeRoot ?? defaultLocalE5RuntimeRoot();
    const packageJson = join(runtimeRoot, "package.json");
    const requireFromRuntime = createRequire(packageJson);

    let entry: string;
    try {
      entry = requireFromRuntime.resolve(TRANSFORMERS_PACKAGE);
    } catch {
      throw new LocalE5ProviderError(
        "PROVIDER_NOT_PREPARED",
        `Local E5 runtime is not prepared. Run pnpm setup:runtime-breath-e5 first. Expected ${TRANSFORMERS_PACKAGE}@${TRANSFORMERS_VERSION} under ${runtimeRoot}.`,
      );
    }

    let module: TransformersModule;
    try {
      module = await import(pathToFileURL(entry).href) as TransformersModule;
    } catch (error) {
      throw new LocalE5ProviderError(
        "PROVIDER_LOAD_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }

    const cacheDir =
      this.options.modelCacheDir ?? defaultLocalE5ModelCacheDir();
    const modelId = this.options.modelId ?? MODEL_ID;
    module.env.cacheDir = cacheDir;
    module.env.allowRemoteModels = true;
    module.env.allowLocalModels = true;

    try {
      return await module.pipeline(
        "feature-extraction",
        modelId,
        {
          dtype: this.options.dtype ?? "q8",
          device: this.options.device ?? "cpu",
          progress_callback: this.options.progressCallback,
        },
      );
    } catch (error) {
      throw new LocalE5ProviderError(
        "PROVIDER_LOAD_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

export function parseEmbeddingMatrix(
  raw: unknown,
  expectedRows: number,
): number[][] {
  if (!Array.isArray(raw) || raw.length !== expectedRows) {
    throw new LocalE5ProviderError(
      "INVALID_EMBEDDING_OUTPUT",
      "E5 embedding output row count is invalid.",
    );
  }

  const rows = raw.map((row) => {
    if (
      !Array.isArray(row)
      || row.length === 0
      || !row.every(
        (value) => typeof value === "number" && Number.isFinite(value),
      )
    ) {
      throw new LocalE5ProviderError(
        "INVALID_EMBEDDING_OUTPUT",
        "E5 embedding output contains an invalid vector.",
      );
    }
    return row as number[];
  });

  const width = rows[0]!.length;
  if (!rows.every((row) => row.length === width)) {
    throw new LocalE5ProviderError(
      "INVALID_EMBEDDING_OUTPUT",
      "E5 embedding vectors have inconsistent dimensions.",
    );
  }
  return rows;
}

function dot(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) {
    throw new LocalE5ProviderError(
      "INVALID_EMBEDDING_OUTPUT",
      "E5 embedding vectors have inconsistent dimensions.",
    );
  }
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    sum += left[index]! * right[index]!;
  }
  return sum;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
