import assert from "node:assert/strict";
import test from "node:test";
import {
  createMemoryDetailLocation,
  createMemoryListLocation,
  getMemoryDetailLocation,
  getSafeMemoryReturnTo,
  readMemorySearch,
} from "../web/src/pages/memory-location.js";

test("Memory detail location preserves a normalized searched list URL", () => {
  const list = createMemoryListLocation(" long-term goal ");
  assert.equal(list, "/memory?q=long-term+goal");
  const detail = createMemoryDetailLocation("memory-1", list);
  assert.deepEqual(
    getMemoryDetailLocation(new URL(detail, "https://example.test").search),
    { memoryId: "memory-1", returnTo: list },
  );
  assert.equal(readMemorySearch("?q=long-term+goal"), "long-term goal");
});

test("Memory returnTo accepts only the Memory list and its search parameter", () => {
  assert.equal(
    getSafeMemoryReturnTo("/memory?q=goal"),
    "/memory?q=goal",
  );
  for (const unsafe of [
    "https://evil.test/memory?q=goal",
    "//evil.test/memory",
    "/task?q=goal",
    "/memory?memory=secret",
    "/memory?returnTo=%2Fmemory",
    "/memory?q=one&q=two",
    "/memory?category=goal",
  ]) {
    assert.equal(getSafeMemoryReturnTo(unsafe), "/memory");
  }
  assert.equal(getSafeMemoryReturnTo(null), "/memory");
});

test("invalid Memory detail ids safely select list mode", () => {
  assert.deepEqual(getMemoryDetailLocation("?memory=%2Fbad"), {
    memoryId: null,
    returnTo: "/memory",
  });
});
