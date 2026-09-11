import assert from "node:assert/strict";
import test from "node:test";
import {
  codePointLength,
  codePointOffsetToCodeUnitOffset,
  codeUnitOffsetToCodePointOffset,
  replaceCodePointRange,
  sliceCodePoints,
} from "../src/shared/unicode.js";

test("shared paper unicode offsets use code points, including astral and ZWJ characters", () => {
  const value = "A中😀👩‍💻é";
  assert.equal(codePointLength(value), 8);
  assert.equal(codePointOffsetToCodeUnitOffset(value, 0), 0);
  assert.equal(codePointOffsetToCodeUnitOffset(value, 3), 4);
  assert.equal(codeUnitOffsetToCodePointOffset(value, 4), 3);
  assert.equal(sliceCodePoints(value, 3, 6), "😀👩‍💻");
  assert.equal(replaceCodePointRange(value, 1, 3, "好"), "A好👩‍💻é");
});

test("shared paper unicode utility rejects offsets inside surrogate pairs", () => {
  assert.throws(() => codeUnitOffsetToCodePointOffset("😀", 1));
  assert.throws(() => codePointOffsetToCodeUnitOffset("😀", 2));
});
