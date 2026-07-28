import assert from "node:assert/strict";
import test from "node:test";
import {
  createMemoryDetailLocation,
  createMemoryListLocation,
  getMemoryDetailLocation,
  getSafeMemoryReturnTo,
  readMemoryFilters,
} from "../web/src/pages/memory-location.js";

test("Memory detail location preserves normalized search and category filters", () => {
  const list = createMemoryListLocation({
    q: " long-term goal ",
    category: "project",
  });
  assert.equal(list, "/memory?q=long-term+goal&category=project");
  const detail = createMemoryDetailLocation("memory-1", list);
  assert.deepEqual(
    getMemoryDetailLocation(new URL(detail, "https://example.test").search),
    { memoryId: "memory-1", returnTo: list },
  );
  assert.deepEqual(
    readMemoryFilters("?q=long-term+goal&category=project"),
    { q: "long-term goal", category: "project" },
  );
});

test("Memory returnTo accepts only normalized Memory search and category parameters", () => {
  assert.equal(
    getSafeMemoryReturnTo("/memory?category=goal&q=100%25_%5C"),
    "/memory?q=100%25_%5C&category=goal",
  );
  for (const unsafe of [
    "https://evil.test/memory?q=goal",
    "//evil.test/memory",
    "/task?q=goal",
    "/memory?memory=secret",
    "/memory?returnTo=%2Fmemory",
    "/memory?q=one&q=two",
    "/memory?category=goal&category=project",
    "/memory?category=not-a-category",
  ]) {
    assert.equal(getSafeMemoryReturnTo(unsafe), "/memory");
  }
  assert.equal(getSafeMemoryReturnTo(null), "/memory");
});

test("Memory filters safely discard invalid category and empty conditions", () => {
  assert.deepEqual(readMemoryFilters("?q=&category=%3Cscript%3E"), {
    q: "",
    category: "",
  });
  assert.equal(
    createMemoryListLocation({ q: "", category: "" }),
    "/memory",
  );
});

test("invalid Memory detail ids safely select list mode", () => {
  assert.deepEqual(getMemoryDetailLocation("?memory=%2Fbad"), {
    memoryId: null,
    returnTo: "/memory",
  });
});
