import assert from "node:assert/strict";
import {existsSync, readFileSync} from "node:fs";
import test from "node:test";
import { NativeLiveMacRuntimeExecutor } from "../src/domains/bridge/mac/native-live-mac-runtime-executor.js";
import { command } from "./helpers/native-live-mac-runtime-executor-fixtures.js";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const unused = async () => {throw new Error("unused");};
const descriptor = (id: number) => ({attachmentId: `00000000-0000-4000-8000-${String(id).padStart(12,"0")}`,
  filename: "output.webp", mimeType: "image/webp", sizeBytes: 42, sha256: "a".repeat(64), kind: "image" as const});

test("retired MemeRepo code, daemon injection and SDK registration are absent", () => {
  for (const path of ["src/domains/bridge/mac/native-live-mac-meme-sender.ts", "tools/claude-bridge/src/send-meme-mcp.mjs"]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, path);
  }
  for (const path of ["scripts/native-live-mac-daemon.ts", "src/domains/bridge/mac/native-live-mac-runtime-executor.ts",
    "src/domains/bridge/mac/native-live-mac-claude-transport.ts", "tools/claude-bridge/src/agent-sdk-claude-transport.mjs", ".env.example"]) {
    assert.doesNotMatch(read(path), /NativeLiveMacMemeSender|NativeLiveMemeRuntimeHandlers|memeHandlers|MEME_SYSTEM_HINT|leileios-local-memes|createMemeMcpServer|leileios-album|LEILEI_MEME_GITHUB_TOKEN|LEILEI_MEME_GH_PATH/, path);
  }
});

test("retired constructor input cannot inject meme handlers into an ordinary file turn", async () => {
  const runtime = {sendNew: unused, resume: unused, fork: unused, async executeTurn(_prompt: string, options: any) {
    assert.equal(options.memeHandlers, undefined);
    await options.sendFileHandler({path: "output.webp", displayName: null});
    return {providerSessionId: "ordinary", normalizedEvents: []};
  }};
  const executor = new (NativeLiveMacRuntimeExecutor as any)(runtime, "/workspace", null,
    {sendFile: async () => descriptor(1)}, null, {sendMeme: unused});
  const result = await executor.execute(command({protocol_version: 4}));
  assert.equal(result.status, "success");
  assert.deepEqual(result.output_attachment_ids, [descriptor(1).attachmentId]);
});

test("ordinary files retain eight slots including concurrent sends and exact output IDs", async () => {
  let sends = 0;
  const runtime = {sendNew: unused, resume: unused, fork: unused, async executeTurn(_prompt: string, options: any) {
    for (let i = 0; i < 5; i++) await options.sendFileHandler({path: "output.webp", displayName: null});
    const pending = await Promise.allSettled(Array.from({length: 5}, () => options.sendFileHandler({path: "output.webp", displayName: null})));
    assert.deepEqual(pending.map(x => x.status), ["fulfilled", "fulfilled", "fulfilled", "rejected", "rejected"]);
    await assert.rejects(options.sendFileHandler({path: "output.webp", displayName: null}), /8 files/);
    return {providerSessionId: "ordinary", normalizedEvents: []};
  }};
  const result = await new NativeLiveMacRuntimeExecutor(runtime, "/workspace", null,
    {sendFile: async () => {const id = ++sends; await new Promise(r => setImmediate(r)); return descriptor(id);}}).execute(command({protocol_version: 4}));
  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error(JSON.stringify(result));
  assert.equal(sends, 8);
  assert.deepEqual(result.output_attachment_ids, Array.from({length: 8}, (_, i) => descriptor(i + 1).attachmentId));
});

test("failed ordinary uploads release slots and each new turn starts a fresh quota", async () => {
  let calls = 0; let successes = 0;
  const runtime = {sendNew: unused, resume: unused, fork: unused, async executeTurn(_prompt: string, options: any) {
    await assert.rejects(options.sendFileHandler({path: "output.webp", displayName: null}), /unavailable/);
    for (let i = 0; i < 8; i++) await options.sendFileHandler({path: "output.webp", displayName: null});
    await assert.rejects(options.sendFileHandler({path: "output.webp", displayName: null}), /8 files/);
    return {providerSessionId: "ordinary", normalizedEvents: []};
  }};
  const executor = new NativeLiveMacRuntimeExecutor(runtime, "/workspace", null, {sendFile: async () => {
    if (++calls % 9 === 1) throw new Error("unavailable");
    return descriptor(++successes);
  }});
  for (let turn = 0; turn < 2; turn++) {
    const result = await executor.execute(command({protocol_version: 4}));
    assert.equal(result.status, "success");
    if (result.status !== "success") throw new Error(JSON.stringify(result));
    assert.equal(result.output_attachment_ids?.length, 8);
  }
  assert.equal(calls, 18); assert.equal(successes, 16);
});
