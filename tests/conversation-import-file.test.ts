import assert from "node:assert/strict";
import { deflateRawSync, gunzipSync } from "node:zlib";
import test from "node:test";
import {
  encodeRawConversationSource,
  readTopLevelConversationObjects,
  stageConversationUpload,
} from "../src/domains/conversation/conversation-import-file.js";

async function *chunked(buffer: Buffer, size: number): AsyncGenerator<Buffer> {
  for (let offset = 0; offset < buffer.length; offset += size) {
    yield buffer.subarray(offset, Math.min(buffer.length, offset + size));
  }
}

function singleEntryZip(filename: string, data: Buffer): Buffer {
  const name = Buffer.from(filename, "utf8");
  const compressed = deflateRawSync(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);

  const centralOffset = local.length + name.length + compressed.length;
  const centralSize = central.length + name.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);

  return Buffer.concat([
    local,
    name,
    compressed,
    central,
    name,
    eocd,
  ]);
}

test("direct JSON uploads are hashed, streamed by top-level object, and archived gzip-losslessly", async () => {
  const raw = Buffer.from(
    JSON.stringify([
      { conversation_id: "one", mapping: {} },
      { conversation_id: "two", mapping: { node: { message: null } } },
    ]),
    "utf8",
  );
  const staged = await stageConversationUpload(chunked(raw, 7), "conversations.json");
  try {
    assert.equal(staged.container, "json");
    assert.equal(staged.rawBytes, raw.length);
    assert.match(staged.rawSha256, /^[0-9a-f]{64}$/u);
    const values = [];
    for await (const value of readTopLevelConversationObjects(staged.jsonPaths[0]!)) {
      values.push(value);
    }
    assert.deepEqual(values.map((value) => value.conversation_id), ["one", "two"]);

    const stored = await encodeRawConversationSource(staged);
    assert.equal(stored.encoding, "gzip");
    assert.deepEqual(gunzipSync(stored.data), raw);
  } finally {
    await staged.cleanup();
  }
});

test("official-style ZIP uploads extract conversations.json without flattening the raw ZIP", async () => {
  const json = Buffer.from(JSON.stringify([{ uuid: "claude", chat_messages: [] }]), "utf8");
  const zip = singleEntryZip("conversations.json", json);
  const staged = await stageConversationUpload(chunked(zip, 11), "conversations-000.zip");
  try {
    assert.equal(staged.container, "zip");
    assert.equal(staged.jsonPaths.length, 1);
    const values = [];
    for await (const value of readTopLevelConversationObjects(staged.jsonPaths[0]!)) {
      values.push(value);
    }
    assert.equal(values[0]?.uuid, "claude");

    const stored = await encodeRawConversationSource(staged);
    assert.equal(stored.encoding, "raw");
    assert.deepEqual(stored.data, zip);
  } finally {
    await staged.cleanup();
  }
});

test("ZIP uploads without a conversation data member are rejected", async () => {
  const zip = singleEntryZip("other.json", Buffer.from("[]", "utf8"));
  await assert.rejects(
    () => stageConversationUpload(chunked(zip, 13), "export.zip"),
    (error: unknown) => (
      typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === "CONVERSATION_IMPORT_NO_CONVERSATIONS_JSON"
    ),
  );
});

test("top-level JSON parser handles escaped quotes and nested arrays across tiny chunks", async () => {
  const raw = Buffer.from(JSON.stringify([
    { uuid: "one", text: "a \"quoted\" value", nested: [{ x: [1, 2, 3] }] },
  ]));
  const staged = await stageConversationUpload(chunked(raw, 1), "tiny.json");
  try {
    const values = [];
    for await (const value of readTopLevelConversationObjects(staged.jsonPaths[0]!)) {
      values.push(value);
    }
    assert.equal(values[0]?.text, 'a "quoted" value');
  } finally {
    await staged.cleanup();
  }
});
