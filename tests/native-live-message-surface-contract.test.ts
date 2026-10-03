import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeNativeLiveEvents } from "../src/domains/conversation/native-live-conversation-orchestrator.js";
import { normalizeClaudeEvents } from "../tools/claude-bridge/src/normalized-events.mjs";
import { authorizeNativeLiveConversationProjections } from "../src/domains/conversation/native-live-conversation-content-projector.js";
const normalize = (raw: unknown[]) =>
  normalizeClaudeEvents(raw, { logicalConversationId: "c", mode: "new" });

test("execution, tasks, candidates and telemetry stay outside Chat; questions retain Activity backing", () => {
  const events = normalize([
    {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "q", name: "AskUserQuestion", input: {} },
        ],
      },
    },
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "q",
            content: [{ type: "resource_link", uri: "ui://app" }],
          },
        ],
      },
    },
    ...[
      "task_started",
      "task_progress",
      "task_updated",
      "task_notification",
      "background_tasks_changed",
      "elicitation_complete",
      "permission_denied",
      "vcs_state_changed",
      "session_state_changed",
    ].map((subtype) => ({ type: "system", subtype })),
    {
      type: "result",
      structured_output: { answer: 42 },
      result: "",
      usage: { input_tokens: 12 },
    },
    { type: "rate_limit_event", rate_limit_info: {} },
  ]);
  const blocks = canonicalizeNativeLiveEvents(events).blocks;
  assert.deepEqual(blocks.map(block => block.kind), ["tool_use", "tool_result"]);
  assert.equal(blocks[0].payload?.tool_name, "AskUserQuestion");
  assert.equal(blocks[1].payload?.tool_use_id, "q");
});

test("ordinary assistant text remains canonical, subagent text stays runtime", () => {
  const blocks = canonicalizeNativeLiveEvents(
    normalize([
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "hello" }] },
      },
      {
        type: "assistant",
        parent_tool_use_id: "parent",
        message: { content: [{ type: "text", text: "private agent output" }] },
      },
    ]),
  ).blocks;
  assert.deepEqual(
    blocks.map((b) => b.text),
    ["hello"],
  );
});

test("backend projection opts structured tool output into canonical content with entity refs", async () => {
  const events = [
    {
      type: "tool_result" as const,
      payload: {
        tool_use_id: "t",
        output: { answer: 42 },
        structured: {
          schema_version: 1,
          parts: [{ type: "json", value: { answer: 42 } }],
        },
        conversation_projection: {
          schema_version: 1,
          identity: "canonical_tool_result",
          reason: "explicit_share",
          refs: [{ type: "attachment_ref", entity_id: "a" }],
        },
      },
    },
  ];
  const authority = await authorizeNativeLiveConversationProjections({userId:"u",decisions:[{event:events[0],projection:events[0].payload.conversation_projection}],
    resolveAttachment:async()=>({userId:"u",attachmentId:"a",status:"ready",filename:"a.pdf",mimeType:"application/pdf",kind:"file",sizeBytes:3,sha256:"a".repeat(64)})});
  const blocks = canonicalizeNativeLiveEvents(events,authority).blocks;
  assert.deepEqual(blocks.map(block => block.kind), ["tool_result", "canonical_tool_result"]);
  assert.deepEqual(blocks[0]?.payload, events[0].payload);
  const block = blocks[1];
  assert.equal(block?.kind, "canonical_tool_result");
  assert.equal(block?.payload?.schema_version, 1);
  assert.deepEqual(block?.payload?.refs, [
    { type: "attachment_ref", entity_id: "a" },
  ]);
});

test("unknown provider content and events retain bounded diagnostics without binary or reasoning", () => {
  const secret = "SECRET_THINKING";
  const binary = Buffer.alloc(100000, 1).toString("base64");
  const events = normalize([
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "future_widget",
            text: "x".repeat(100000),
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: binary,
            },
            thinking: secret,
          },
        ],
      },
    },
    {
      type: "future_event",
      subtype: "v2",
      payload: { answer: 42, reasoning: secret },
    },
    {
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: secret },
          { type: "redacted_thinking", data: secret },
        ],
      },
    },
  ]);
  const json = JSON.stringify(events);
  assert.ok(json.length < 70000);
  assert.ok(!json.includes(binary.slice(0, 64)));
  assert.ok(!json.includes(secret));
  assert.ok(
    events.some(
      (e) => e.payload?.diagnostic_code === "UNSUPPORTED_PROVIDER_CONTENT",
    ),
  );
  assert.ok(
    events.some(
      (e) => e.payload?.diagnostic_code === "UNSUPPORTED_PROVIDER_EVENT",
    ),
  );
  assert.equal(canonicalizeNativeLiveEvents(events).blocks[0]?.kind, "unknown");
});

test("structured output preserves result-level bounded payload and requires explicit projection", () => {
  const events = normalize([
    { type: "result", result: "", structured_output: { answer: 42 } },
  ]);
  assert.deepEqual(
    events.find((e) => e.type === "result")?.payload?.structured_output
      ?.payload,
    { answer: 42 },
  );
  assert.deepEqual(canonicalizeNativeLiveEvents(events).blocks, []);
});

test("tool binary has structured materialization state, MIME and size", () => {
  const events = normalize([
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "AQID",
                },
              },
            ],
          },
        ],
      },
    },
  ]);
  const structured = events.find((e) => e.type === "tool_result")?.payload
    ?.structured;
  assert.equal(structured?.schema_version, 1);
  assert.equal(structured?.parts[0]?.type, "image");
  assert.equal(structured?.parts[0]?.materialization, "pending");
  assert.equal(structured?.parts[0]?.media_type, "image/png");
  assert.equal(structured?.parts[0]?.byte_length, 3);
});

test("raw attachment candidate requires ready binding, execution payload cannot opt itself in", () => {
  assert.deepEqual(
    canonicalizeNativeLiveEvents([
      { type: "attachment", payload: { uri: "file:///candidate.png" } },
    ]).blocks,
    [],
  );
  const events = normalize([
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t",
            content: {
              conversation_projection: {
                schema_version: 1,
                identity: "canonical_tool_result",
                reason: "explicit_share",
                refs: [],
              },
            },
          },
        ],
      },
    },
  ]);
  assert.deepEqual(canonicalizeNativeLiveEvents(events).blocks.map(block => block.kind), ["tool_result"]);
});

test("SDK server tool execution is Activity, never unsupported conversation content", () => {
  const blocks = canonicalizeNativeLiveEvents(
    normalize([
      {
        type: "assistant",
        message: {
          content: [
            { type: "server_tool_use", id: "t", name: "web_search", input: {} },
            { type: "web_search_tool_result", tool_use_id: "t", content: [] },
          ],
        },
      },
    ]),
  ).blocks;
  assert.deepEqual(blocks, []);
});

test("MCP PDF binary is metadata-only and ui resource remains reference_only", () => {
  const binary = Buffer.alloc(75000, 7).toString("base64");
  const events = normalize([
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t",
            content: [
              { type: "document", mimeType: "application/pdf", data: binary },
              { type: "resource_link", uri: "ui://app" },
            ],
          },
        ],
      },
    },
  ]);
  assert.ok(!JSON.stringify(events).includes(binary.slice(0, 64)));
  const result = events.find((e) => e.type === "tool_result")!;
  assert.equal(
    result.payload.structured.parts[0].media_type,
    "application/pdf",
  );
  assert.equal(result.payload.structured.parts[0].byte_length, 75000);
  assert.equal(result.payload.structured.parts[1].capability, "reference_only");
});

test("known file/resource candidates, fallback models and context telemetry do not enter Chat", () => {
  const events = normalize([
    {
      type: "assistant",
      context_usage: { used_tokens: 10 },
      message: { content: [{ type: "text", text: "context report" }] },
    },
    {
      type: "assistant",
      message: {
        content: [
          { type: "container_upload", file_id: "provider-f" },
          { type: "fallback", from: { model: "m" }, to: { model: "n" } },
          { type: "resource_link", uri: "mcp://candidate" },
        ],
      },
    },
  ]);
  assert.deepEqual(canonicalizeNativeLiveEvents(events).blocks, []);
  assert.ok(JSON.stringify(events).includes("provider-f"));
});

test("future provider projection versions cannot fail an otherwise valid turn", () => {
  const result = canonicalizeNativeLiveEvents([
    {
      type: "tool_result",
      payload: {
        output: "answer",
        conversation_projection: {
          schema_version: 2,
          identity: "canonical_tool_result",
          reason: "explicit_share",
          refs: [],
        },
      },
    },
  ]);
  assert.equal(result.error,null);
  assert.deepEqual(result.blocks.map(b=>b.kind),["tool_result"]);
});

test("structured tool parts report their own truncation independently of legacy output", () => {
  const events = normalize([
    {
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "t", content: "x".repeat(10000) },
        ],
      },
    },
  ]);
  const payload = events.find((e) => e.type === "tool_result")!.payload;
  assert.equal(payload.output.length, 10000);
  assert.equal(payload.structured.parts[0].text.length, 8000);
  assert.equal(payload.structured.truncated, true);
});

test("full SDK tool output survives separately from model-directed text with identity binding", () => {
  const events = normalize([
    {
      type: "user",
      tool_use_result: {
        tool_use_id: "t",
        structuredContent: { answer: 42 },
        generated_files: [{ path: "report.pdf", mime_type: "application/pdf" }],
      },
      message: {
        content: [
          { type: "tool_result", tool_use_id: "t", content: "Created report" },
        ],
      },
    },
  ]);
  const payload = events.find((e) => e.type === "tool_result")!.payload;
  assert.equal(
    payload.structured.provider_output.payload.structuredContent.answer,
    42,
  );
  assert.equal(
    payload.structured.provider_output.payload.generated_files[0].path,
    "report.pdf",
  );
  assert.equal(payload.provenance.tool_use_id, "t");
  const backing = canonicalizeNativeLiveEvents(events).blocks;
  assert.deepEqual(backing.map(block => block.kind), ["tool_result"]);
  assert.deepEqual(backing[0].payload?.structured, payload.structured);
});

test("ambiguous full tool output is retained as diagnostic runtime data without false attribution", () => {
  const events = normalize([
    {
      type: "user",
      tool_use_result: { structuredContent: { answer: 42 } },
      message: {
        content: [
          { type: "tool_result", tool_use_id: "a", content: "a" },
          { type: "tool_result", tool_use_id: "b", content: "b" },
        ],
      },
    },
  ]);
  assert.ok(
    events.some(
      (e) => e.payload?.diagnostic_code === "UNATTRIBUTED_TOOL_OUTPUT",
    ),
  );
  for (const e of events.filter((e) => e.type === "tool_result"))
    assert.equal(e.payload.structured.provider_output, undefined);
});

test("future result subtype retains unknown payload and a visible compatibility diagnostic", () => {
  const events = normalize([
    {
      type: "result",
      subtype: "future_result",
      result: "",
      future_payload: { answer: 42 },
    },
  ]);
  const diagnostic = events.find(
    (e) => e.payload?.diagnostic_code === "UNSUPPORTED_PROVIDER_EVENT",
  );
  assert.equal(
    diagnostic?.payload.compatibility.payload.future_payload.answer,
    42,
  );
  assert.equal(diagnostic?.payload.provenance.raw_subtype, "future_result");
  assert.deepEqual(canonicalizeNativeLiveEvents(events).blocks, []);
});
