/**
 * Independent, read-only Mind hybrid scorer for the installed Claude Code Hook.
 * It does not start Native Live/Wake or write Mind. Owned by a per-user
 * launchd LaunchAgent; the original Railway-only Hook path remains available.
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { LocalHybridMindRecallScorer } from "../src/domains/runtime/mind/local-hybrid-mind-recall.js";
import { MacMindSnapshotSync } from "../src/domains/bridge/mac/native-live-mac-mind-snapshot-sync.js";
import { startMindRecallSemanticServer } from "../src/domains/bridge/mac/native-live-mac-mind-recall-server.js";

const home = homedir();
const configPath = join(home, ".claude", "leileios-mind", "mind.env");
const socketPath = join(home, ".leileios", "claude-code-mind", "hybrid.sock");
const SYNC_INTERVAL_MS = 60_000;

async function credentials(): Promise<{url: string; token: string}> {
  const stat = await fs.lstat(configPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() ||
      stat.size > 16_000 || (stat.mode & 0o077) !== 0) {
    throw new Error("PRIVATE_CONFIG_INVALID");
  }
  const parsed = parseEnv(await fs.readFile(configPath, "utf8"));
  if (parsed.LEILEI_MIND_RECALL_MODE !== "hybrid_conditional_v1")
    throw new Error("HYBRID_NOT_ENABLED");
  const url = parsed.LEILEI_MIND_RECALL_URL;
  const token = parsed.LEILEI_MIND_RECALL_TOKEN;
  if (!url || !token || !token.trim())
    throw new Error("RECALL_CONFIG_MISSING");
  const origin = new URL(url);
  if (origin.protocol !== "https:" || origin.username || origin.password ||
      origin.search || origin.hash)
    throw new Error("RECALL_URL_INVALID");
  return {url: origin.href.replace(/\/$/, ""), token};
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const {url, token} = await credentials();
  const scorer = new LocalHybridMindRecallScorer();
  let closeServer: (() => Promise<void>) | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let exiting = false;
  const shutdown = () => {
    if (exiting) return;
    exiting = true;
    if (interval) clearInterval(interval);
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
    const sync = new MacMindSnapshotSync(url, token, scorer);
    // Cold startup or temporarily sleeping Railway cannot permanently disable
    // the Hook. Before ready, the Hook uses the original Railway-only path.
    for (;;) {
      if (exiting) return;
      try {
        await sync.refresh();
        break;
      } catch {
        await wait(15_000);
      }
    }
    if (exiting) return;
    closeServer = await startMindRecallSemanticServer(scorer, socketPath);
    interval = setInterval(() => {
      void sync.refresh().catch(() => undefined);
    }, SYNC_INTERVAL_MS);
    process.stdout.write("mind_hybrid_background_ready\n");
  } catch {
    // Never print credentials, Memory texts or the internal error objects.
    process.stderr.write("mind_hybrid_background_unavailable\n");
    await closeServer?.().catch(() => undefined);
    await scorer.close().catch(() => undefined);
    process.exitCode = 1;
  }
}
await main();
