import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  LocalE5BreathSemanticScorer,
  defaultLocalE5RuntimeRoot,
  localE5PackageVersion,
} from "../src/domains/runtime/local-e5-embedding.js";

const runtimeRoot = defaultLocalE5RuntimeRoot();
await mkdir(runtimeRoot, { recursive: true });

const packageJsonPath = join(runtimeRoot, "package.json");
let prepared = false;
try {
  const existing = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  prepared =
    existing.dependencies?.["@huggingface/transformers"]
    === localE5PackageVersion();
} catch {
  // Install below.
}

if (!prepared) {
  process.stderr.write(`[e5-setup] installing local Transformers.js runtime at ${runtimeRoot}\n`);
  await writeFile(
    packageJsonPath,
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          "@huggingface/transformers": localE5PackageVersion(),
        },
      },
      null,
      2,
    ) + "\n",
  );

  await run("npm", [
    "install",
    "--prefix",
    runtimeRoot,
    "--no-audit",
    "--no-fund",
    "--save-exact",
  ]);
}

process.stderr.write("[e5-setup] runtime ready; loading multilingual E5 model\n");

let lastProgress = "";
const fileProgressBuckets = new Map<string, number>();
let lastModelActivityAt = Date.now();
let activeFile: string | null = null;
const scorer = new LocalE5BreathSemanticScorer({
  repairCorruptCache: true,
  progressCallback(info) {
    if (!isRecord(info) || typeof info.status !== "string") return;
    lastModelActivityAt = Date.now();

    if (info.status === "repair") {
      process.stderr.write(
        `[e5-model] corrupted partial cache detected; clearing and retrying${typeof info.path === "string" ? ` ${info.path}` : ""}\n`,
      );
      return;
    }

    if (
      info.status === "progress_total"
      && typeof info.progress === "number"
    ) {
      const message = `[e5-model] total ${info.progress.toFixed(1)}%\n`;
      if (message !== lastProgress) {
        lastProgress = message;
        process.stderr.write(message);
      }
      return;
    }

    if (
      info.status === "progress"
      && typeof info.file === "string"
      && typeof info.progress === "number"
    ) {
      activeFile = info.file;
      const bucket = Math.floor(info.progress / 5);
      if (fileProgressBuckets.get(info.file) !== bucket) {
        fileProgressBuckets.set(info.file, bucket);
        const loaded =
          typeof info.loaded === "number"
            ? ` ${formatMegabytes(info.loaded)}`
            : "";
        const total =
          typeof info.total === "number"
            ? `/${formatMegabytes(info.total)}`
            : "";
        process.stderr.write(
          `[e5-model] ${info.file} ${info.progress.toFixed(1)}%${loaded}${total}\n`,
        );
      }
      return;
    }

    if (
      (info.status === "download"
        || info.status === "done"
        || info.status === "ready")
    ) {
      const file =
        typeof info.file === "string"
          ? ` ${info.file}`
          : "";
      if (typeof info.file === "string") activeFile = info.file;
      process.stderr.write(`[e5-model] ${info.status}${file}\n`);
    }
  },
});

const heartbeat = setInterval(() => {
  const idleSeconds = Math.round((Date.now() - lastModelActivityAt) / 1_000);
  process.stderr.write(
    `[e5-model] still active${activeFile ? ` on ${activeFile}` : ""}; last progress event ${idleSeconds}s ago\n`,
  );
}, 30_000);
heartbeat.unref();

let warm;
try {
  warm = await scorer.score({
  query: "本地语义召回准备完成",
  candidates: [
    {
      stateId: "warm",
      kind: "memory",
      text: "本地 embedding 模型已经准备好",
    },
  ],
  });
} finally {
  clearInterval(heartbeat);
}

process.stdout.write(
  JSON.stringify({
    status: "prepared",
    runtimeRoot,
    packageVersion: localE5PackageVersion(),
    warmScore: warm.get("warm") ?? null,
  }, null, 2) + "\n",
);

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0 && !signal) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} exited with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`,
        ),
      );
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
