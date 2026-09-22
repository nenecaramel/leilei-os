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

  constructor(private readonly options: LocalE5Options = {}) {}

  async score(input: {
    query: string;
    candidates: readonly BreathSemanticCandidate[];
  }): Promise<ReadonlyMap<string, number>> {
    const query = input.query.trim();
    if (!query || input.candidates.length === 0) return new Map();

    const extractor = await this.getExtractor();
    const texts = [
      `query: ${query}`,
      ...input.candidates.map((candidate) => `passage: ${candidate.text.trim()}`),
    ];

    let raw: unknown;
    try {
      raw = (await extractor(texts, {
        pooling: "mean",
        normalize: true,
      })).tolist();
    } catch (error) {
      throw new LocalE5ProviderError(
        "PROVIDER_LOAD_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }

    const vectors = parseEmbeddingMatrix(raw, texts.length);
    const queryVector = vectors[0]!;
    const scores = new Map<string, number>();

    input.candidates.forEach((candidate, index) => {
      const candidateVector = vectors[index + 1]!;
      scores.set(candidate.stateId, clamp01(dot(queryVector, candidateVector)));
    });

    return scores;
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
