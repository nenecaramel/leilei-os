import assert from "node:assert/strict";
import test from "node:test";
import {
  getDiaryScrollStorage,
  readDiaryScrollPosition,
  saveDiaryScrollPosition,
} from "../web/src/pages/diary-scroll-restoration.js";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

test("Diary scroll positions are isolated by the complete filtered list URL", () => {
  const target = storage();
  saveDiaryScrollPosition(target, "/diary?tag=Japan", 640);
  saveDiaryScrollPosition(target, "/diary?tag=work", 120);
  assert.equal(
    readDiaryScrollPosition(target, "/diary?tag=Japan"),
    640,
  );
  assert.equal(
    readDiaryScrollPosition(target, "/diary?tag=work"),
    120,
  );
  assert.equal(readDiaryScrollPosition(target, "/diary"), null);
});

test("Diary scroll storage failures and corrupt values safely fall back", () => {
  const unavailable = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  assert.doesNotThrow(() => {
    saveDiaryScrollPosition(unavailable, "/diary", 50);
  });
  assert.equal(readDiaryScrollPosition(unavailable, "/diary"), null);

  const corrupt = {
    getItem() { return "not-a-position"; },
    setItem() {},
  };
  assert.equal(readDiaryScrollPosition(corrupt, "/diary"), null);
  assert.equal(readDiaryScrollPosition(null, "/diary"), null);
  assert.doesNotThrow(() => {
    saveDiaryScrollPosition(null, "/diary", 50);
  });

  const blockedWindow = Object.defineProperty({}, "sessionStorage", {
    get() {
      throw new Error("blocked");
    },
  }) as Pick<Window, "sessionStorage">;
  assert.equal(getDiaryScrollStorage(blockedWindow), null);
});
