import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultMindComparisonDirectory } from "../src/domains/bridge/mac/native-live-mac-mind-comparison.js";

type Line = {
  status?: string; outcome?: string; dropped_before?: number;
  current_ids?: string[]; shadow_ids?: string[]; current_ms?: number; shadow_ms?: number;
};

function spread(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? null;
  return {median: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? null};
}

/** Counts and timings only: never prompts, memory text or record ids. */
export function summarizeMindComparisons(raw: string) {
  const summary = {
    recorded: 0, compared: 0, unreadable: 0, dropped: 0, current_failed: 0,
    same: 0, overlapping: 0, different: 0, only_current: 0, only_shadow: 0, both_empty: 0,
  };
  const currentMs: number[] = [];
  const shadowMs: number[] = [];
  for (const text of raw.split("\n").filter(Boolean)) {
    let line: Line;
    try { line = JSON.parse(text) as Line; } catch { summary.unreadable += 1; continue; }
    summary.recorded += 1;
    summary.dropped += line.dropped_before ?? 0;
    if (line.outcome === "failed") summary.current_failed += 1;
    if (typeof line.current_ms === "number") currentMs.push(line.current_ms);
    if (line.status !== "compared") continue;
    summary.compared += 1;
    if (typeof line.shadow_ms === "number") shadowMs.push(line.shadow_ms);
    const current = new Set(line.current_ids ?? []);
    const shadow = line.shadow_ids ?? [];
    const shared = shadow.filter(id => current.has(id)).length;
    if (current.size === 0 && shadow.length === 0) summary.both_empty += 1;
    else if (current.size === 0) summary.only_shadow += 1;
    else if (shadow.length === 0) summary.only_current += 1;
    else if (shared === 0) summary.different += 1;
    else if (shared === current.size && shared === shadow.length) summary.same += 1;
    else summary.overlapping += 1;
  }
  return {...summary, current_ms: spread(currentMs), shadow_ms: spread(shadowMs)};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw = await readFile(join(defaultMindComparisonDirectory(), "log.jsonl"), "utf8")
    .catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return ""; throw error; });
  console.log(JSON.stringify(summarizeMindComparisons(raw), null, 2));
}
