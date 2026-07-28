import assert from "node:assert/strict";
import test from "node:test";
import {
  readMemoryScrollPosition,
  saveMemoryScrollPosition,
} from "../web/src/pages/memory-scroll-restoration.js";

test("Memory scroll positions are isolated by complete list URL", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };

  saveMemoryScrollPosition(storage, "/memory?q=goal", 420.4);
  saveMemoryScrollPosition(storage, "/memory?q=project", 81);

  assert.equal(
    readMemoryScrollPosition(storage, "/memory?q=goal"),
    420,
  );
  assert.equal(
    readMemoryScrollPosition(storage, "/memory?q=project"),
    81,
  );
  assert.equal(readMemoryScrollPosition(storage, "/memory"), null);
});

test("Memory scroll storage errors and corrupt values safely fall back", () => {
  const throwing = {
    getItem() {
      throw new Error("storage blocked");
    },
    setItem() {
      throw new Error("storage blocked");
    },
  };
  saveMemoryScrollPosition(throwing, "/memory", 20);
  assert.equal(readMemoryScrollPosition(throwing, "/memory"), null);
  assert.equal(
    readMemoryScrollPosition({
      getItem: () => "not-a-position",
      setItem: () => {},
    }, "/memory"),
    null,
  );
});
