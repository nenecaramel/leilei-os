import { spawn as nodeSpawn } from "node:child_process";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BreathSemanticCandidate,
  BreathSemanticScorer,
} from "./breath-semantic-recall.js";

const HELPER_VERSION = "v1";
const DEFAULT_HELPER_SOURCE = fileURLToPath(
  new URL("../../../tools/macos-natural-language-embedding/main.swift", import.meta.url),
);

export type MacOSNaturalLanguageEmbeddingOptions = {
  language?: string | null;
  xcrunCommand?: string;
  helperSourcePath?: string;
  helperBinaryPath?: string;
  compileTimeoutMs?: number;
  scoreTimeoutMs?: number;
};

type HelperOutput = {
  language: string;
  revision: number;
  scores: Array<{ stateId: string; score: number }>;
};

export class MacOSNaturalLanguageEmbeddingError extends Error {
  constructor(
    readonly code:
      | "UNSUPPORTED_PLATFORM"
      | "HELPER_COMPILE_FAILED"
      | "HELPER_EXECUTION_FAILED"
      | "INVALID_HELPER_OUTPUT",
    message: string,
  ) {
    super(message);
    this.name = "MacOSNaturalLanguageEmbeddingError";
  }
}

export class MacOSNaturalLanguageBreathSemanticScorer
implements BreathSemanticScorer {
  private compilePromise: Promise<string> | null = null;

  constructor(
    private readonly options: MacOSNaturalLanguageEmbeddingOptions = {},
  ) {}

  async score(input: {
    query: string;
    candidates: readonly BreathSemanticCandidate[];
  }): Promise<ReadonlyMap<string, number>> {
    if (process.platform !== "darwin") {
      throw new MacOSNaturalLanguageEmbeddingError(
        "UNSUPPORTED_PLATFORM",
        "macOS Natural Language embeddings require darwin.",
      );
    }

    const query = input.query.trim();
    if (!query || input.candidates.length === 0) return new Map();

    const binary = await this.ensureHelperBinary();
    const payload = JSON.stringify({
      query,
      candidates: input.candidates.map((candidate) => ({
        stateId: candidate.stateId,
        text: candidate.text,
      })),
      language: this.options.language ?? null,
    });

    let stdout: string;
    try {
      ({ stdout } = await runChild(binary, [], {
        input: payload,
        timeoutMs: this.options.scoreTimeoutMs ?? 15_000,
      }));
    } catch (error) {
      throw new MacOSNaturalLanguageEmbeddingError(
        "HELPER_EXECUTION_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }

    return parseMacOSNaturalLanguageEmbeddingOutput(
      stdout,
      new Set(input.candidates.map((candidate) => candidate.stateId)),
    );
  }

  private ensureHelperBinary(): Promise<string> {
    if (!this.compilePromise) {
      this.compilePromise = this.compileHelper();
    }
    return this.compilePromise;
  }

  private async compileHelper(): Promise<string> {
    const source = this.options.helperSourcePath ?? DEFAULT_HELPER_SOURCE;
    const binary =
      this.options.helperBinaryPath
      ?? join(tmpdir(), `leileios-macos-sentence-embedding-${HELPER_VERSION}`);

    try {
      await access(binary);
      return binary;
    } catch {
      // Compile below.
    }

    try {
      await runChild(
        this.options.xcrunCommand ?? "xcrun",
        [
          "swiftc",
          "-O",
          "-framework",
          "NaturalLanguage",
          source,
          "-o",
          binary,
        ],
        {
          timeoutMs: this.options.compileTimeoutMs ?? 60_000,
        },
      );
    } catch (error) {
      throw new MacOSNaturalLanguageEmbeddingError(
        "HELPER_COMPILE_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }

    return binary;
  }
}

export function parseMacOSNaturalLanguageEmbeddingOutput(
  raw: string,
  allowedStateIds?: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MacOSNaturalLanguageEmbeddingError(
      "INVALID_HELPER_OUTPUT",
      "Embedding helper returned invalid JSON.",
    );
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.scores)) {
    throw new MacOSNaturalLanguageEmbeddingError(
      "INVALID_HELPER_OUTPUT",
      "Embedding helper output must contain a scores array.",
    );
  }

  const scores = new Map<string, number>();
  for (const item of parsed.scores) {
    if (
      !isRecord(item)
      || typeof item.stateId !== "string"
      || typeof item.score !== "number"
      || !Number.isFinite(item.score)
      || item.score < 0
      || item.score > 1
      || (allowedStateIds && !allowedStateIds.has(item.stateId))
    ) {
      throw new MacOSNaturalLanguageEmbeddingError(
        "INVALID_HELPER_OUTPUT",
        "Embedding helper returned an invalid score entry.",
      );
    }
    scores.set(item.stateId, item.score);
  }
  return scores;
}

async function runChild(
  command: string,
  args: string[],
  options: {
    input?: string;
    timeoutMs: number;
  },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) child.kill("SIGTERM");
    }, options.timeoutMs);

    const finish = (
      result:
        | { ok: true; stdout: string; stderr: string }
        | { ok: false; error: Error },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result.ok) resolve({ stdout: result.stdout, stderr: result.stderr });
      else reject(result.error);
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (cause) => {
      finish({
        ok: false,
        error: new Error(`${command} failed to start: ${cause.message}`),
      });
    });
    child.on("close", (code, signal) => {
      if (code === 0 && !signal) {
        finish({ ok: true, stdout, stderr });
        return;
      }
      finish({
        ok: false,
        error: new Error(
          `${command} exited with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}: ${stderr.trim() || "no stderr"}`,
        ),
      });
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
