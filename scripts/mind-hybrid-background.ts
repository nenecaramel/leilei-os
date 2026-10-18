/**
 * Independent, read-only on-demand E5 + ritrieve scorer for Claude Desktop.
 * It never polls Railway or downloads/stores the Memory database.
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { LocalHybridMindRecallScorer } from "../src/domains/runtime/mind/local-hybrid-mind-recall.js";
import { startClaudeCodeMindHybridServer } from "../src/domains/runtime/mind/claude-code-mind-hybrid-server.js";

const home = homedir();
const configPath = join(home, ".claude", "leileios-mind", "mind.env");
const socketPath = join(home, ".leileios", "claude-code-mind", "hybrid.sock");

async function requireHybridMode(): Promise<void> {
  const stat = await fs.lstat(configPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() ||
      stat.size > 16_000 || (stat.mode & 0o077) !== 0)
    throw new Error("PRIVATE_CONFIG_INVALID");
  const parsed = parseEnv(await fs.readFile(configPath, "utf8"));
  if (parsed.LEILEI_MIND_RECALL_MODE !== "hybrid_conditional_v1")
    throw new Error("HYBRID_NOT_ENABLED");
}

async function main(): Promise<void> {
  await requireHybridMode();
  const scorer = new LocalHybridMindRecallScorer();
  let closeServer: (() => Promise<void>) | null = null;
  let exiting = false;
  const shutdown = () => {
    if (exiting) return;
    exiting = true;
    void (async () => {
      await closeServer?.().catch(() => undefined);
      await scorer.close().catch(() => undefined);
      process.exit(0);
    })();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  try {
    await scorer.warmup();
    if (exiting) return;
    closeServer = await startClaudeCodeMindHybridServer(scorer, socketPath);
    process.stdout.write("mind_hybrid_background_ready\n");
  } catch {
    process.stderr.write("mind_hybrid_background_unavailable\n");
    await closeServer?.().catch(() => undefined);
    await scorer.close().catch(() => undefined);
    process.exitCode = 1;
  }
}
await main();
