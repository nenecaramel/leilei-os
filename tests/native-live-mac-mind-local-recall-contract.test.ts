import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { createInternalAuthMiddleware } from "../src/auth/internal-auth.js";
import { createMindRecallRouter } from "../src/web-api/mind-recall-internal-router.js";
import { ClaudeCodeMindRecallService } from "../src/domains/runtime/mind/claude-code-mind-recall.js";
import { DEFAULT_MIND_LOOP_CONFIG } from "../src/domains/runtime/mind/default-backend-mind-runtime.js";
import { createMindState } from "../src/domains/runtime/mind/mind-writer.js";
import type { SubjectStateWrite } from "../src/domains/runtime/subject-state/subject-state-contract.js";
import { NativeLiveMacMindLibrary } from "../src/domains/bridge/mac/native-live-mac-mind-library.js";
import { NativeLiveMacMindLocalRecall } from "../src/domains/bridge/mac/native-live-mac-mind-local-recall.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const memory = (n: number, text: string) => createMindState({id: id(n), userId: "u1", subjectId: "G", kind: "memory", text,
  source: {origin: "manual", occurredAt: "2026-10-01T00:00:00Z", note: null}});

// The real router, recall service and version check; only the database and the E5 model are stand-ins.
test("the real server renders exactly the Mac's choice and refuses it once a memory changes", async t => {
  const states: SubjectStateWrite[] = [memory(1, "jasmine tea"), memory(2, "rainy walks"), ...[3, 4, 5, 6, 7, 8, 9, 10].map(n => memory(n, `unrelated ${n}`))];
  const service = new ClaudeCodeMindRecallService({list: async () => states}, DEFAULT_MIND_LOOP_CONFIG, "G", {
    create: async input => ({recall_id: randomUUID(), context_sha256: input.contextSha256}),
    confirm: async () => ({outcome: "confirmed" as const}),
    issueSigned: async input => ({recall_id: randomUUID(), context_sha256: input.contextSha256, recall_token: "signed"}),
  });
  const app = express();
  app.use(express.json());
  app.use("/internal/mind", createInternalAuthMiddleware("relay-token", "u1"), createMindRecallRouter({
    service, requireActiveUser: async () => undefined,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // Pretend E5: whatever mentions tea is close, the rest is not.
  const scorer = {score: async (request: {candidates: Array<{stateId: string; text: string}>}) =>
    new Map(request.candidates.map(c => [c.stateId, c.text.includes("tea") ? 0.93 : 0.7]))};
  const library = new NativeLiveMacMindLibrary({baseUrl, token: "relay-token", scorer});
  const local = new NativeLiveMacMindLocalRecall({library, scorer, baseUrl, token: "relay-token"});
  t.after(() => library.close());
  const ask = () => local.recall({session_id: "s", query: "jasmine tea", exclude_ids: [], caller: "claude_code",
    context_epoch: 0, receipt_mode: "signed_v1"});

  await library.load();
  const delivered = await ask();
  assert.ok(delivered);
  assert.deepEqual(delivered.memory_ids, [id(1)]);
  assert.match(String(delivered.context), /jasmine tea/);
  assert.equal(delivered.recall_token, "signed");

  states[0]!.text = "green tea now";
  assert.equal(await ask(), null, "an edited memory changes the version; the stale copy is refused");
  await library.idle();
  assert.deepEqual((await ask())?.memory_ids, [id(1)], "after reloading, the edited text is what is chosen");
  assert.match(String((await ask())?.context), /green tea now/);

  states.splice(0, 1);
  assert.equal(await ask(), null, "a deleted memory is never delivered from the old copy");
  await library.idle();
  assert.deepEqual((await ask())?.memory_ids, []);
});
