import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { E5_DIMENSIONS } from "./claude-code-semantic-lsh.js";

type Extractor = (texts: string[], options: {pooling: "mean"; normalize: true}) =>
  Promise<{tolist(): unknown}>;
type Transformers = {
  pipeline(task: "feature-extraction", model: string,
    options: {dtype: "q8"; device: "cpu"}): Promise<Extractor>;
  env: {cacheDir: string | null; allowRemoteModels: boolean; allowLocalModels: boolean};
};

/** Railway-side E5 uses the existing separately prepared E5 CPU runtime.
 * No keys, new cloud embedding provider, or changes to Native Live models.
 */
export class ClaudeCodeRailwayE5 {
  private extractor: Promise<Extractor> | null = null;
  private cache = new Map<string, number[]>();

  warmup(): Promise<void> {
    return this.embedQuery("语义检索模型准备完成").then(() => undefined);
  }
  async embedQuery(query: string): Promise<number[]> {
    const normalized = query.trim().slice(0, 512);
    if (!normalized) throw new Error("Empty E5 query.");
    const cached = this.cache.get(normalized);
    if (cached) return [...cached];
    const vectors = await this.encode([`query: ${normalized}`]);
    this.cache.set(normalized, vectors[0]!);
    if (this.cache.size > 48) this.cache.delete(this.cache.keys().next().value!);
    return [...vectors[0]!];
  }
  async embedPassages(texts: readonly string[]): Promise<number[][]> {
    if (texts.length < 1 || texts.length > 16 ||
        texts.some(text => !text.trim() || text.length > 2_000))
      throw new Error("Invalid E5 passages.");
    return this.encode(texts.map(text => `passage: ${text.trim()}`));
  }
  private async encode(texts: string[]): Promise<number[][]> {
    const extractor = await (this.extractor ??= this.load().catch(error => {
      this.extractor = null;
      throw error;
    }));
    const raw: unknown = (await extractor(texts, {pooling: "mean", normalize: true})).tolist();
    if (!Array.isArray(raw) || raw.length !== texts.length)
      throw new Error("Invalid E5 embedding row count.");
    return raw.map(item => {
      if (!Array.isArray(item) || item.length !== E5_DIMENSIONS ||
          item.some(x => typeof x !== "number" || !Number.isFinite(x)))
        throw new Error("Invalid E5 vector.");
      return item as number[];
    });
  }
  private async load(): Promise<Extractor> {
    const runtime = process.env.LEILEI_MIND_E5_RUNTIME_ROOT ??
      join(homedir(), ".cache", "leileios", "embedding-runtime-v1");
    const cacheDir = process.env.LEILEI_MIND_E5_MODEL_CACHE ??
      join(homedir(), ".cache", "leileios", "embedding-models-v1");
    const requireFromRuntime = createRequire(join(runtime, "package.json"));
    const entry = requireFromRuntime.resolve("@huggingface/transformers");
    const module = await import(pathToFileURL(entry).href) as Transformers;
    module.env.cacheDir = cacheDir;
    // Setup happens explicitly before starting Railway; no model network
    // download can be triggered by an ordinary recall request.
    module.env.allowRemoteModels = false;
    module.env.allowLocalModels = true;
    return module.pipeline("feature-extraction", "Xenova/multilingual-e5-small",
      {dtype: "q8", device: "cpu"});
  }
}
