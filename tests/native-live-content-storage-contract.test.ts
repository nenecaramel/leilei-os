import assert from "node:assert/strict";
import test from "node:test";
import {
  readableContentKind,
  storedContentKind,
  boundCanonicalPayload,
  parseConversationProjection,
} from "../src/domains/conversation/native-live-content-contract.js";
import { normalizeClaudeEvents } from "../tools/claude-bridge/src/normalized-events.mjs";
import { parseNativeLiveRuntimeResultTelemetry } from "../src/domains/bridge/protocol/runtime-protocol/telemetry.js";

test("new identities roundtrip through versioned unknown storage while legacy kinds retain identity", () => {
  for (const kind of [
    "artifact",
    "resource",
    "canonical_tool_result",
  ] as const) {
    assert.equal(storedContentKind(kind), "unknown");
    assert.equal(
      readableContentKind("unknown", { schema_version: 1, identity: kind }),
      kind,
    );
  }
  for (const kind of ["text", "attachment", "tool_use", "tool_result"] as const)
    assert.equal(readableContentKind(kind, null), kind);
  assert.equal(readableContentKind("future_kind", {}), "unknown");
  assert.equal(
    readableContentKind("unknown", { schema_version: 2, identity: "artifact" }),
    "unknown",
  );
});

test("malformed projections fail closed and entity identities require stable matching refs", () => {
  for (const value of [
    null,
    {},
    {
      schema_version: 2,
      identity: "resource",
      reason: "explicit_share",
      refs: [],
    },
    {
      schema_version: 1,
      identity: "resource",
      reason: "explicit_share",
      refs: [],
    },
    {
      schema_version: 1,
      identity: "canonical_tool_result",
      reason: "provider_said_so",
      refs: [],
    },
  ])
    assert.equal(parseConversationProjection(value), null);
  assert.equal(
    parseConversationProjection({
      schema_version: 1,
      identity: "resource",
      reason: "materialized_send",
      refs: [{ type: "resource_ref", entity_id: "r" }],
    })?.identity,
    "resource",
  );
});

test("writer bounds hostile cyclic, broad, non-JSON and reasoning payloads", () => {
  const raw: Record<string, unknown> = {
    reasoning: "SECRET",
    image: { type: "base64", data: "a".repeat(100000) },
    wide: Array.from({ length: 100 }, () => ({ text: "x".repeat(10000) })),
    invalid: Infinity,
  };
  raw.cycle = raw;
  const serialized = JSON.stringify(boundCanonicalPayload(raw));
  assert.ok(serialized.length < 64000);
  assert.ok(!serialized.includes("SECRET"));
  assert.ok(!serialized.includes("a".repeat(64)));
  assert.equal(boundCanonicalPayload(raw).truncated, true);
});

test("result structured output roundtrips through durable runtime metadata parser", () => {
  const event = normalizeClaudeEvents(
    [
      {
        type: "result",
        subtype: "success",
        result: "",
        structured_output: {
          answer: 42,
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: "AQID",
          },
          thinking: "SECRET",
        },
      },
    ],
    { logicalConversationId: "c", mode: "new" },
  ).find((e) => e.type === "result");
  const metadata = parseNativeLiveRuntimeResultTelemetry(
    event!.payload.telemetry,
  );
  assert.equal(
    (metadata.structured_output?.payload as Record<string, unknown>).answer,
    42,
  );
  assert.ok(!JSON.stringify(metadata).includes("SECRET"));
  assert.ok(!JSON.stringify(metadata).includes("AQID"));
});

test("repository storage encodes extension identity and rejects invalid references", async () => {
  const { storedContentPayload } =
    await import("../src/domains/conversation/native-live-content-contract.js");
  const payload = storedContentPayload("artifact", {
    schema_version: 1,
    identity: "artifact",
    refs: [{ type: "artifact_ref", entity_id: "a" }],
    structured: { answer: 42 },
  });
  assert.equal(
    readableContentKind(storedContentKind("artifact"), payload),
    "artifact",
  );
  assert.deepEqual(payload?.refs, [{ type: "artifact_ref", entity_id: "a" }]);
  assert.throws(
    () =>
      storedContentPayload("artifact", {
        schema_version: 1,
        identity: "artifact",
        refs: [],
      }),
    TypeError,
  );
});

test("durable structured output parser excludes bytes and hidden reasoning even from raw runtime input", () => {
  const telemetry = normalizeClaudeEvents([{ type: "result", result: "" }], {
    logicalConversationId: "c",
    mode: "new",
  })[0].payload.telemetry;
  const result = parseNativeLiveRuntimeResultTelemetry({
    ...telemetry,
    structured_output: {
      schema_version: 1,
      payload: {
        thinking: "SECRET",
        file: {
          type: "base64",
          media_type: "application/pdf",
          data: "a".repeat(10000),
        },
      },
    },
  });
  assert.ok(!JSON.stringify(result).includes("SECRET"));
  assert.ok(!JSON.stringify(result).includes("a".repeat(64)));
});

test("clipped provider keys cannot crash or silently overwrite compatibility data", () => {
  const raw = {
    ["x".repeat(116) + ":2"]: 0,
    ["x".repeat(128) + "a"]: 1,
    ["x".repeat(128) + "b"]: 2,
  };
  const result = boundCanonicalPayload(raw);
  const payload = result.compatibility_payload as Record<string, unknown>;
  assert.deepEqual(Object.values(payload), [0, 1, 2]);
  assert.equal(result.truncated, true);
});

test("legacy non-core rows stay visible but hidden reasoning and binary cannot leak on read", async () => {
  const { readableContentData } =
    await import("../src/domains/conversation/native-live-content-contract.js");
  const reasoning = readableContentData("thinking", "thinking", "SECRET", {
    thinking: "SECRET",
  });
  assert.equal(reasoning.kind, "unknown");
  assert.equal(reasoning.text, null);
  assert.ok(!JSON.stringify(reasoning).includes("SECRET"));
  const binary = readableContentData("image", "image", null, {
    source: {
      type: "base64",
      media_type: "image/png",
      data: "a".repeat(10000),
    },
  });
  assert.equal(binary.kind, "unknown");
  assert.ok(!JSON.stringify(binary).includes("a".repeat(64)));
  const legacy = { tool_use_id: "t", output: "legacy" };
  assert.deepEqual(
    readableContentData("tool_result", "tool_result", null, legacy),
    { kind: "tool_result", text: null, payload: legacy },
  );
});

test("writer drops every hidden reasoning delta variant from older runtime payloads", () => {
  for (const type of [
    "thinking_delta",
    "reasoning_delta",
    "signature_delta",
    "reasoning",
  ])
    assert.ok(
      !JSON.stringify(boundCanonicalPayload({ type, text: "SECRET" })).includes(
        "SECRET",
      ),
    );
});

test("hidden rawType variants never expose old unknown row text", async () => {
  const { readableContentData } =
    await import("../src/domains/conversation/native-live-content-contract.js");
  for (const type of [
    "thinking_delta",
    "reasoning_delta",
    "signature_delta",
    "compaction",
  ])
    assert.ok(
      !JSON.stringify(
        readableContentData("unknown", type, "SECRET", null),
      ).includes("SECRET"),
    );
});

test("structured JSON data strings remain payload while declared binary data is excluded", () => {
  const raw = {
    data: "business text",
    file: { type: "base64", media_type: "application/pdf", data: "AQID" },
  };
  const payload = boundCanonicalPayload(raw).compatibility_payload as Record<
    string,
    unknown
  >;
  assert.equal(payload.data, "business text");
  assert.ok(!JSON.stringify(payload).includes("AQID"));
});

 test("physical unknown cannot impersonate authoritative text or attachments", () => {
  for (const identity of ["text", "attachment", "tool_use", "tool_result"]) {
    assert.equal(readableContentKind("unknown", { schema_version: 1, identity }), "unknown");
  }
});
