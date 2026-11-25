import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { summarizeMindComparisons } from "../scripts/mind-comparison-report.js";
import {
  chooseMindComparison,
  NativeLiveMacMindComparison,
  type MindComparisonOffer,
} from "../src/domains/bridge/mac/native-live-mac-mind-comparison.js";
import { startMindRecallSemanticServer } from "../src/domains/bridge/mac/native-live-mac-mind-recall-server.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const V1 = "a".repeat(64);
const V2 = "b".repeat(64);
const SCORES = new Map([[A, 0.9], [B, 0.89], [C, 0.7]]);
const offer = (over: Partial<MindComparisonOffer> = {}): MindComparisonOffer => ({
  session: "c".repeat(64), query: "tea please", outcome: "delivered",
  current_ids: [A], exclude_ids: [], current_ms: 1200, ...over,
});
const page = (memories: unknown[], next: number | null = null, version = V1, total = memories.length) =>
  Response.json({success: true, data: {version, total, memories, next_offset: next}});
const LIBRARY = [{stateId: A, text: "secret-text tea"}, {stateId: B, text: "other"}, {stateId: C, text: "far"}];

async function fixture(t: TestContext, options: {
  respond?: (offset: number, call: number) => Response | Promise<Response>;
  score?: () => Promise<ReadonlyMap<string, number>>;
  maxLogBytes?: number;
  ageLimitMs?: number;
} = {}) {
  const directory = join(await mkdtemp(join(tmpdir(), "mind-compare-")), "log");
  t.after(() => rm(join(directory, ".."), {recursive: true, force: true}));
  const requests: string[] = [];
  const batches: number[] = [];
  let now = 1_000_000;
  const comparison = new NativeLiveMacMindComparison({
    baseUrl: "http://relay.invalid", token: "t", directory, delayMs: 0,
    maxLogBytes: options.maxLogBytes, libraryMaxAgeMs: options.ageLimitMs,
    now: () => now,
    fetch: async (url, init) => {
      const target = new URL(String(url));
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer t");
      requests.push(target.pathname + target.search);
      return options.respond
        ? options.respond(Number(target.searchParams.get("offset") ?? 0), requests.length)
        : page(LIBRARY);
    },
    scorer: {score: async input => {
      batches.push(input.candidates.length);
      return options.score ? options.score() : new Map(input.candidates.map(c => [c.stateId, SCORES.get(c.stateId) ?? 0]));
    }},
  });
  t.after(() => comparison.close());
  const lines = async () => {
    const raw = await readFile(join(directory, "log.jsonl"), "utf8").catch(() => "");
    return raw.split("\n").filter(Boolean).map(line => JSON.parse(line));
  };
  return {comparison, requests, batches, directory, lines, advance: (ms: number) => { now += ms; }};
}

test("a comparison records both sides privately without any memory text", async t => {
  const f = await fixture(t);
  assert.equal(f.comparison.offer(offer()), true);
  await f.comparison.idle();
  const [line] = await f.lines();
  assert.equal(line.status, "compared");
  assert.deepEqual(line.current_ids, [A]);
  assert.equal(line.outcome, "delivered");
  assert.equal(line.current_ms, 1200);
  assert.equal(line.query, "tea please");
  assert.equal(line.library_size, 3);
  assert.equal(line.library_version, V1);
  assert.equal(line.shadow_ids[0], A);
  assert.equal(line.top.length, 3);
  assert.equal(line.sem_median, 0.89);
  assert.ok(Number.isFinite(line.shadow_ms));
  assert.ok(!JSON.stringify(line).includes("secret-text"));
  assert.equal((await stat(f.directory)).mode & 0o777, 0o700);
  assert.equal((await stat(join(f.directory, "log.jsonl"))).mode & 0o777, 0o600);
});

test("offering never waits; one comparison runs at a time and extra offers are dropped and counted", async t => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, {score: async () => { await gate; return SCORES; }});
  assert.equal(f.comparison.offer(offer({query: "first"})), true);
  assert.equal(f.comparison.offer(offer({query: "second"})), false);
  release();
  await f.comparison.idle();
  assert.equal(f.comparison.offer(offer({query: "third"})), true);
  await f.comparison.idle();
  const lines = await f.lines();
  assert.deepEqual(lines.map(line => [line.query, line.dropped_before]), [["first", 0], ["third", 1]]);
});

test("the library is downloaded once, encoded in small batches and refreshed only after it ages", async t => {
  const many = Array.from({length: 20}, (_, i) => ({stateId: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`, text: `m${i}`}));
  const f = await fixture(t, {respond: () => page(many), ageLimitMs: 600_000});
  f.comparison.offer(offer()); await f.comparison.idle();
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.batches, [8, 8, 4, 20]);
  f.comparison.offer(offer()); await f.comparison.idle();
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.batches.slice(4), [20]);
  f.advance(600_001);
  f.comparison.offer(offer()); await f.comparison.idle();
  assert.equal(f.requests.length, 2, "an aged library is refreshed after, not by a timer");
  assert.equal((await f.lines()).length, 3);
});

test("pages from different versions are never mixed; one retry then an honest failure", async t => {
  let mixed = true;
  const respond = (offset: number, call: number) => {
    if (offset === 0) return page([LIBRARY[0]], 1, V1, 2);
    if (mixed) return page([LIBRARY[1]], null, V2, 2);
    return page([LIBRARY[1]], null, call > 0 ? V1 : V2, 2);
  };
  const f = await fixture(t, {respond});
  f.comparison.offer(offer()); await f.comparison.idle();
  assert.equal(f.requests.length, 4);
  mixed = false;
  f.comparison.offer(offer()); await f.comparison.idle();
  const lines = await f.lines();
  assert.deepEqual(lines.map(line => line.status), ["failed", "compared"]);
  assert.equal(lines[1].library_size, 2);
});

test("a repeating or short snapshot cannot loop or pass as complete", async t => {
  const f = await fixture(t, {respond: () => page([LIBRARY[0]], 0, V1, 9)});
  f.comparison.offer(offer()); await f.comparison.idle();
  assert.equal((await f.lines())[0].status, "failed");
  assert.ok(f.requests.length <= 2);
});

test("memories already excluded from the real recall cannot be picked by the comparison", async t => {
  const f = await fixture(t);
  f.comparison.offer(offer({exclude_ids: [A]})); await f.comparison.idle();
  const [line] = await f.lines();
  assert.ok(!line.shadow_ids.includes(A));
  assert.ok(!line.top.some((row: {id: string}) => row.id === A));
});

test("scorer failure and an empty real recall are recorded, never thrown", async t => {
  const f = await fixture(t, {score: async () => { throw new Error("private provider detail"); }});
  f.comparison.offer(offer({outcome: "failed", current_ids: []})); await f.comparison.idle();
  const [line] = await f.lines();
  assert.equal(line.status, "failed");
  assert.equal(line.outcome, "failed");
  assert.ok(!JSON.stringify(line).includes("private provider detail"));
});

test("a full log stops recording and stops all further work", async t => {
  const f = await fixture(t, {maxLogBytes: 100});
  f.comparison.offer(offer()); await f.comparison.idle();
  assert.deepEqual(await f.lines(), []);
  assert.equal(f.comparison.offer(offer()), false);
});

test("a symlinked log file is refused", async t => {
  const f = await fixture(t);
  f.comparison.offer(offer()); await f.comparison.idle();
  const { symlink, unlink } = await import("node:fs/promises");
  const victim = join(f.directory, "victim");
  await writeFile(victim, "");
  await unlink(join(f.directory, "log.jsonl"));
  await symlink(victim, join(f.directory, "log.jsonl"));
  f.comparison.offer(offer()); await f.comparison.idle();
  assert.equal(await readFile(victim, "utf8"), "");
});

test("closing aborts a waiting comparison", async t => {
  const f = await fixture(t, {respond: () => new Promise<Response>(() => undefined)});
  f.comparison.offer(offer());
  await new Promise(resolve => setImmediate(resolve));
  await f.comparison.close();
  assert.deepEqual(await f.lines(), []);
  assert.equal(f.comparison.offer(offer()), false);
});

test("choice: nothing below the floor, a second only when close to the first", () => {
  const row = (id: string, sem: number, lex = 0) => ({id, sem, lex});
  assert.deepEqual(chooseMindComparison([row(A, 0.79, 0.9)]), []);
  assert.deepEqual(chooseMindComparison([row(A, 0.9), row(B, 0.895), row(C, 0.89)]), [A, B]);
  assert.deepEqual(chooseMindComparison([row(A, 0.95, 0.5), row(B, 0.82)]), [A]);
  const crowd = Array.from({length: 9}, (_, i) => row(`crowd-${i}`, 0.87));
  assert.deepEqual(chooseMindComparison([...crowd, row(A, 0.89)]), [], "nothing stands out");
  assert.deepEqual(chooseMindComparison([...crowd, row(A, 0.93)]), [A]);
});

async function post(socketPath: string, path: string, body: unknown) {
  return new Promise<number>((resolve, reject) => {
    const request = httpRequest({socketPath, path, method: "POST"}, response => {
      response.resume(); response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end(JSON.stringify(body));
  });
}
async function socketDirectory(t: TestContext) {
  const home = await mkdtemp(join(tmpdir(), "mc-"));
  t.after(() => rm(home, {recursive: true, force: true}));
  return join(home, "s.sock");
}

test("/compare answers at once even while a real /score is running, and validates its body", async t => {
  const socket = await socketDirectory(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const offers: MindComparisonOffer[] = [];
  const close = await startMindRecallSemanticServer(
    {score: async () => { await gate; return new Map([[A, 0.9]]); }}, socket,
    {offer: input => { offers.push(input); return true; }},
  );
  t.after(close);
  const scoring = post(socket, "/score", {query: "q", candidates: [{stateId: A, kind: "memory", text: "x"}]});
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(await post(socket, "/compare", offer()), 202);
  assert.equal(await post(socket, "/compare", {...offer(), extra: 1}), 400);
  assert.equal(await post(socket, "/compare", {...offer(), current_ids: ["x"]}), 400);
  assert.equal(offers.length, 1);
  release();
  assert.equal(await scoring, 200);
});

test("without a comparison /compare does not exist", async t => {
  const socket = await socketDirectory(t);
  const close = await startMindRecallSemanticServer({score: async () => new Map()}, socket);
  t.after(close);
  assert.equal(await post(socket, "/compare", offer()), 404);
});

test("the summary reports counts and speed without any text or ids", () => {
  const line = (over: object) => JSON.stringify({status: "compared", outcome: "delivered", query: "PRIVATE",
    current_ids: [A], shadow_ids: [A], current_ms: 1000, shadow_ms: 10, dropped_before: 0, ...over});
  const summary = summarizeMindComparisons([
    line({}), line({shadow_ids: [B], current_ms: 2000, shadow_ms: 30}), line({shadow_ids: []}),
    line({outcome: "failed", current_ids: [], shadow_ids: [C], dropped_before: 2}), line({status: "failed"}), "broken",
  ].join("\n"));
  assert.equal(summary.recorded, 5);
  assert.equal(summary.compared, 4);
  assert.equal(summary.unreadable, 1);
  assert.equal(summary.dropped, 2);
  assert.deepEqual(summary.same, 1);
  assert.deepEqual(summary.only_current, 1);
  assert.deepEqual(summary.only_shadow, 1);
  assert.deepEqual(summary.different, 1);
  assert.equal(summary.current_failed, 1);
  assert.equal(summary.current_ms.max, 2000);
  assert.equal(summary.shadow_ms.max, 30);
  const text = JSON.stringify(summary);
  assert.ok(!text.includes("PRIVATE") && !text.includes(A));
});
