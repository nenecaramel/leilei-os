import assert from "node:assert/strict";
import test from "node:test";
import { MindProductService } from "../src/domains/runtime/mind/mind-product-service.js";
import { createMindState } from "../src/domains/runtime/mind/mind-writer.js";
const id = "11111111-1111-4111-8111-111111111111";
function row() {
  const state = createMindState({
    id,
    userId: "u",
    subjectId: "G",
    kind: "memory",
    text: "test memory",
    source: { origin: "manual", occurredAt: null, note: null },
  });
  return {
    ...state,
    createdAt: "2026-10-08T00:00:00.000Z",
    updatedAt: "2026-10-08T00:00:00.000Z",
  };
}
test("content precondition ignores lifecycle writes but detects edits", async () => {
  const value = row();
  const service = new MindProductService(
    { get: async () => value } as never,
    "G",
  );
  const before = await service.get({ userId: "u", stateId: id });
  assert.match(before.contentVersion, /^[a-f0-9]{64}$/);
  value.payload = {
    ...value.payload,
    lifecycle_v1: { lastRecalledAt: "2026-10-08T01:00:00.000Z" },
  };
  value.updatedAt = "2026-10-08T01:00:00.000Z";
  assert.equal(
    (await service.get({ userId: "u", stateId: id })).contentVersion,
    before.contentVersion,
  );
  value.text = "edited";
  assert.notEqual(
    (await service.get({ userId: "u", stateId: id })).contentVersion,
    before.contentVersion,
  );
});
test("day read derives exact Shanghai boundaries and rejects invalid dates", async () => {
  let input: any;
  const service = new MindProductService(
    {
      search: async (v: any) => {
        input = v;
        return { rows: [row()], nextCursor: null };
      },
    } as never,
    "G",
  );
  const page = await service.readDay({ userId: "u", date: "2026-10-08" });
  assert.equal(page.items[0]?.occurredAt, null);
  assert.equal(input.occurredFrom, "2026-10-07T16:00:00.000Z");
  assert.equal(input.occurredBefore, "2026-10-08T16:00:00.000Z");
  for (const date of ["2026-02-30", "2026-13-01", "2026-1-01"])
    await assert.rejects(service.readDay({ userId: "u", date }), {
      code: "INVALID_MIND",
    });
});
test("search cursor is bound to filters and identity", async () => {
  const service = new MindProductService(
    {
      search: async () => ({
        rows: [row()],
        nextCursor: { createdAt: "2026-10-08T00:00:00.123456Z", id },
      }),
    } as never,
    "G",
  );
  const p = await service.search({ userId: "u", query: "test", limit: 1 });
  assert.ok(p.nextCursor);
  await assert.rejects(
    service.search({ userId: "u", query: "different", cursor: p.nextCursor }),
    { code: "INVALID_MIND" },
  );
  await assert.rejects(
    service.search({ userId: "other", query: "test", cursor: p.nextCursor }),
    { code: "INVALID_MIND" },
  );
  await assert.rejects(service.search({ userId: "u", limit: 201 }), {
    code: "INVALID_MIND",
  });
  await assert.rejects(
    service.search({
      userId: "u",
      dateFrom: "2026-10-09",
      dateTo: "2026-10-08",
    }),
    { code: "INVALID_MIND" },
  );
});
test("update rejects empty, unsupported, invalid date and missing preconditions", async () => {
  const service = new MindProductService(
    {
      update: async () => {
        throw Error("must not reach repository");
      },
    } as never,
    "G",
  );
  for (const patch of [
    {},
    { text: " " },
    { occurredAt: "2026-02-30T00:00:00Z" },
    { text: "ok", salience: 1 },
    { text: "ok", expectedVersion: "bad" },
  ])
    await assert.rejects(
      service.update({
        userId: "u",
        stateId: id,
        expectedVersion: "a".repeat(64),
        ...patch,
      } as any),
      { code: "INVALID_MIND" },
    );
  await assert.rejects(
    service.update({ userId: "u", stateId: id, text: "ok" } as any),
    { code: "INVALID_MIND" },
  );
});
