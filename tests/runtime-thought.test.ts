import assert from "node:assert/strict";
import test from "node:test";
import {
  THOUGHT_ACTIVE_LIMIT,
  THOUGHT_KEY,
  isActiveThought,
  readThoughtLifecycle,
  writeThoughtActive,
  writeThoughtDropped,
} from "../src/domains/runtime/thought.js";

test("a thought is active or dropped, with no strength or decay", () => {
  assert.equal(THOUGHT_ACTIVE_LIMIT, 3);
  assert.deepEqual(
    readThoughtLifecycle(writeThoughtActive(null)),
    { status: "active" },
  );
  assert.equal(isActiveThought(writeThoughtActive({ keep: 1 })), true);
  assert.equal(writeThoughtActive({ keep: 1 }).keep, 1);
});

test("a subject drop names the message that issued it; a capacity drop names none", () => {
  const subject = writeThoughtDropped(writeThoughtActive(null), {
    reason: "subject",
    droppedAt: "2026-09-30T08:00:00+08:00",
    droppedByMessageId: "a1",
  });
  assert.deepEqual(readThoughtLifecycle(subject), {
    status: "dropped",
    reason: "subject",
    droppedAt: "2026-09-30T00:00:00.000Z",
    droppedByMessageId: "a1",
  });
  assert.equal(isActiveThought(subject), false);

  const capacity = writeThoughtDropped(null, {
    reason: "capacity",
    droppedAt: "2026-09-30T00:00:00.000Z",
  });
  assert.deepEqual(readThoughtLifecycle(capacity), {
    status: "dropped",
    reason: "capacity",
    droppedAt: "2026-09-30T00:00:00.000Z",
    droppedByMessageId: null,
  });

  assert.throws(() =>
    writeThoughtDropped(null, {
      reason: "subject",
      droppedAt: "2026-09-30T00:00:00.000Z",
    })
  );
  assert.throws(() =>
    writeThoughtDropped(null, {
      reason: "capacity",
      droppedAt: "2026-09-30T00:00:00.000Z",
      droppedByMessageId: "a1",
    })
  );
  assert.throws(() =>
    writeThoughtDropped(null, {
      reason: "capacity",
      droppedAt: "not a date",
    })
  );
});

test("missing or malformed lifecycle data fails closed as not active", () => {
  for (const payload of [
    null,
    undefined,
    {},
    { [THOUGHT_KEY]: null },
    { [THOUGHT_KEY]: "active" },
    { [THOUGHT_KEY]: { status: "dormant" } },
    { [THOUGHT_KEY]: { status: "dropped" } },
    {
      [THOUGHT_KEY]: {
        status: "dropped",
        reason: "subject",
        droppedAt: "garbage",
      },
    },
    // The retired strength/decay payload must never count as active.
    { thought_v1: { phase: "active", role: "anchor", strength: 1 } },
  ]) {
    assert.equal(isActiveThought(payload), false);
    assert.equal(readThoughtLifecycle(payload), null);
  }
});
