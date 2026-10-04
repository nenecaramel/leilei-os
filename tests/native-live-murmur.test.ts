import assert from "node:assert/strict";
import test from "node:test";
import {
  extractNativeLiveMurmur,
} from "../src/domains/bridge/turn/native-live-murmur.js";

test("ordinary assistant text is passed through without trimming or payload changes", () => {
  const block = {
    kind: "text" as const,
    rawType: "text",
    text: "\n  indented markdown  \n",
    payload: {
      schema_version: 1,
      identity: "text",
      citations: [{ id: "c1" }],
    },
  };

  const result = extractNativeLiveMurmur([block]);

  assert.deepEqual(result.visibleBlocks, [block]);
  assert.equal(result.murmurBlock, null);
});

test("murmur is removed from visible assistant text and persisted separately", () => {
  const result = extractNativeLiveMurmur([
    {
      kind: "text",
      rawType: "text",
      text: "Main answer.\n\n<murmur>Small aside.</murmur>",
      payload: null,
    },
  ]);

  assert.deepEqual(result.visibleBlocks, [{
    kind: "text",
    rawType: "text",
    text: "Main answer.",
    payload: null,
  }]);
  assert.deepEqual(result.murmurBlock, {
    kind: "murmur",
    rawType: "murmur",
    text: "Small aside.",
    payload: {
      schema_version: 1,
      identity: "murmur",
    },
  });
});

test("murmur tags are parsed case-insensitively", () => {
  const result = extractNativeLiveMurmur([
    {
      kind: "text",
      text: "Main <Murmur>Aside</MURMUR>",
    },
  ]);

  assert.equal(result.visibleBlocks[0]?.text, "Main");
  assert.equal(result.murmurBlock?.text, "Aside");
});

test("only the first non-empty murmur is kept while all murmur segments stay out of main text", () => {
  const result = extractNativeLiveMurmur([
    {
      kind: "text",
      text:
        "A<murmur>first</murmur>B<murmur>second</murmur>C",
    },
  ]);

  assert.equal(result.murmurBlock?.text, "first");
  assert.equal(result.visibleBlocks[0]?.text, "ABC");
});

test("Mind-like tags inside murmur are stripped instead of becoming semantic writes", () => {
  const result = extractNativeLiveMurmur([
    {
      kind: "text",
      text:
        "Visible. <murmur><memory>secret</memory> just an aside</murmur>",
    },
  ]);

  assert.equal(result.visibleBlocks[0]?.text, "Visible.");
  assert.equal(result.murmurBlock?.text, "secret just an aside");
  assert.equal(
    JSON.stringify(result.visibleBlocks).includes("secret"),
    false,
  );
});

test("malformed murmur markers never leak raw murmur tags into the main body", () => {
  const result = extractNativeLiveMurmur([
    {
      kind: "text",
      text: "Visible <murmur>unfinished",
    },
  ]);

  assert.equal(result.murmurBlock, null);
  assert.equal(result.visibleBlocks[0]?.text, "Visible");
});
