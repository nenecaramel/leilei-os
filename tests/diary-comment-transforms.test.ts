import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import type { DiaryComment } from "../web/src/pages/DiaryComments.js";

const moduleUrl = new URL("../web/src/pages/diary/comments/diary-comment-transforms.ts", import.meta.url);
async function transforms() {
  assert.ok(existsSync(moduleUrl), "pure comment transforms must have an independent module");
  return import(moduleUrl.href) as Promise<{
    mergeComments(existing: readonly DiaryComment[], incoming: readonly DiaryComment[]): DiaryComment[];
    replaceComment(comments: readonly DiaryComment[], next: DiaryComment): DiaryComment[];
    formatCommentTime(value: string): string;
  }>;
}

function comment(id: string, revision = 1, created_at = "2026-10-08T00:00:00Z"): DiaryComment {
  return Object.freeze({
    id, diary_id: "diary-1", author: "L", content: `revision ${revision}`,
    revision, created_at, updated_at: created_at,
  });
}

test("comment merge deduplicates by ID with incoming-last precedence, not revision precedence", async () => {
  const { mergeComments } = await transforms();
  const existing = Object.freeze([comment("a", 5), comment("a", 6), comment("b")]);
  const incoming = Object.freeze([comment("a", 3), comment("a", 2), comment("c")]);
  const result = mergeComments(existing, incoming);
  assert.deepEqual(result.map(({ id }) => id), ["a", "b", "c"]);
  assert.equal(result[0], incoming[1]);
  assert.equal(result[1], existing[2]);
  assert.equal(existing.length, 3);
  assert.equal(incoming.length, 3);
  assert.deepEqual(mergeComments(result, incoming), result);
});

test("overlapping pages keep raw timestamp ordering and use ID as the stable tie breaker", async () => {
  const { mergeComments } = await transforms();
  const existing = Object.freeze([comment("b"), comment("a")]);
  const incoming = Object.freeze([comment("older", 1, "2026-10-07T23:00:00Z"), comment("b", 2)]);
  assert.deepEqual(mergeComments(existing, incoming).map(({ id }) => id), ["older", "a", "b"]);
  // Preserve the current string-order contract rather than sorting parsed instants.
  assert.deepEqual(mergeComments([], [
    comment("utc", 1, "2026-10-08T00:00:00Z"),
    comment("offset", 1, "2026-10-08T01:00:00+08:00"),
  ]).map(({ id }) => id), ["utc", "offset"]);
  assert.deepEqual(mergeComments([], []), []);
});

test("comment replacement preserves order, changes only matching IDs and never inserts", async () => {
  const { replaceComment } = await transforms();
  const original = Object.freeze([comment("b"), comment("a"), comment("a", 2)]);
  const latest = comment("a", 3);
  const updated = replaceComment(original, latest);
  assert.deepEqual(updated.map(({ id }) => id), ["b", "a", "a"]);
  assert.equal(updated[0], original[0]);
  assert.equal(updated[1], latest);
  assert.equal(updated[2], latest);
  const absent = replaceComment(original, comment("missing"));
  assert.deepEqual(absent, original);
  assert.notEqual(absent, original);
  assert.equal(original[1].revision, 1);
});

test("comment time formatting preserves local wall time, minute precision and invalid fallback", async () => {
  const { formatCommentTime } = await transforms();
  assert.equal(formatCommentTime(new Date(2026, 9, 8, 7, 5, 59, 123).toISOString()), "2026.10.08 07:05");
  assert.equal(formatCommentTime("invalid time"), "invalid time");
  assert.equal(formatCommentTime(""), "");
});
