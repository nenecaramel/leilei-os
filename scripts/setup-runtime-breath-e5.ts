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

const scorer = new LocalE5BreathSemanticScorer();
const warm = await scorer.score({
  query: "本地语义召回准备完成",
  candidates: [
    {
      stateId: "warm",
      kind: "memory",
      text: "本地 embedding 模型已经准备好",
    },
  ],
});

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
