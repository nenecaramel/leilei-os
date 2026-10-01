import assert from "node:assert/strict";
import test from "node:test";
import { ClaudeEventNormalizer, normalizeClaudeEvents } from "../src/normalized-events.mjs";

const base = { logicalConversationId: "logical-1", mode: "new", parentProviderSessionId: null };
const realFixture = [
  { type: "system", subtype: "init", session_id: "session-1", model: "claude" },
  { type: "rate_limit_event", session_id: "session-1", rate_limit_info: {} },
  { type: "assistant", session_id: "session-1", message: { content: [{ type: "text", text: "READY" }] } },
  { type: "result", subtype: "success", session_id: "session-1", result: "READY", duration_ms: 42 },
];

test("normalizes real Claude 2.1.267 system, assistant, rate-limit, and result events", () => {
  const events = normalizeClaudeEvents(realFixture, base);
  assert.deepEqual(events.map((event) => event.type), ["session", "runtime", "text", "result"]);
  assert.equal(events[2].payload.text, "READY"); assert.equal(events[3].payload.final_text, "READY");
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3, 4]);
});

test("preserves Claude account usage windows from rate_limit_event", () => {
  const events = normalizeClaudeEvents(
    [
      {
        type: "rate_limit_event",
        session_id: "usage-session",
        rate_limit_info: {
          status: "allowed_warning",
          resetsAt: 1788588000,
          rateLimitType: "seven_day",
          utilization: 0.79,
          overageStatus: "allowed",
          overageResetsAt: 1790812800,
          isUsingOverage: false,
          surpassedThreshold: 0.75,
          unifiedWindows: {
            five_hour: {
              utilization: 0.14,
              resetsAt: 1788284400,
            },
            seven_day: {
              utilization: 0.79,
              resetsAt: 1788588000,
            },
          },
        },
      },
    ],
    base,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "runtime");
  assert.deepEqual(events[0].payload, {
    kind: "claude_account_usage",
    provider: "claude_code",
    status: "allowed_warning",
    active_window: "seven_day",
    windows: [
      {
        kind: "five_hour",
        utilization: 0.14,
        resets_at: "2026-09-01T17:40:00.000Z",
      },
      {
        kind: "seven_day",
        utilization: 0.79,
        resets_at: "2026-09-05T06:00:00.000Z",
      },
    ],
    overage: {
      status: "allowed",
      resets_at: "2026-10-01T00:00:00.000Z",
      disabled_reason: null,
      is_using: false,
    },
    surpassed_threshold: 0.75,
  });
});

test("keeps rate-limit events out of final text and maps synthetic partial/tool contracts", () => {
  const events = normalizeClaudeEvents([{ type: "system", subtype: "init", session_id: "s" }, { type: "assistant", session_id: "s", delta: { text: "hel" } }, { type: "assistant", session_id: "s", message: { content: [{ type: "tool_use", id: "tu-1", name: "Read", input: { path: "x" } }, { type: "tool_result", tool_use_id: "tu-1", content: "ok", is_error: false }] } }], base);
  assert.deepEqual(events.map((event) => event.type), ["session", "partial_text", "tool_use", "tool_result"]);
});

test("normalizes real Agent SDK stream_event text deltas", () => {
  const events = normalizeClaudeEvents(
    [
      {
        type: "system",
        subtype: "init",
        session_id: "stream-event-session",
      },
      {
        type: "stream_event",
        session_id: "stream-event-session",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "text_delta",
            text: "hel",
          },
        },
      },
      {
        type: "stream_event",
        session_id: "stream-event-session",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "text_delta",
            text: "lo",
          },
        },
      },
      {
        type: "stream_event",
        session_id: "stream-event-session",
        event: {
          type: "content_block_delta",
          index: 1,
          delta: {
            type: "thinking_delta",
            thinking: "hidden",
          },
        },
      },
    ],
    base,
  );

  assert.deepEqual(
    events.map((event) => event.type),
    [
      "session",
      "partial_text",
      "partial_text",
    ],
  );
  assert.deepEqual(
    events.slice(1).map(
      (event) => event.payload.delta,
    ),
    ["hel", "lo"],
  );
  assert.deepEqual(
    events.slice(1).map(
      (event) =>
        event.payload.accumulated_length,
    ),
    [3, 5],
  );
});

test("normalizes Agent SDK session state changes as runtime-only provider authority", () => {
  const events = normalizeClaudeEvents(
    [
      {
        type: "system",
        subtype: "session_state_changed",
        session_id: "session-state-1",
        state: "running",
        uuid: "event-running",
      },
      {
        type: "system",
        subtype: "session_state_changed",
        session_id: "session-state-1",
        state: "requires_action",
        uuid: "event-action",
      },
      {
        type: "system",
        subtype: "session_state_changed",
        session_id: "session-state-1",
        state: "idle",
        uuid: "event-idle",
      },
    ],
    base,
  );

  assert.deepEqual(
    events.map((event) => event.type),
    ["runtime", "runtime", "runtime"],
  );
  assert.deepEqual(
    events.map((event) => event.payload),
    [
      {
        kind: "session_state_changed",
        state: "running",
        event_uuid: "event-running",
      },
      {
        kind: "session_state_changed",
        state: "requires_action",
        event_uuid: "event-action",
      },
      {
        kind: "session_state_changed",
        state: "idle",
        event_uuid: "event-idle",
      },
    ],
  );
});

test("normalizes Agent SDK compact boundaries for runtime observability", () => {
  const events = normalizeClaudeEvents(
    [
      { type: "system", subtype: "init", session_id: "s" },
      {
        type: "system",
        subtype: "compact_boundary",
        session_id: "s",
        compact_metadata: {
          trigger: "manual",
          pre_tokens: 81234,
          post_tokens: 12000,
          duration_ms: 4321,
          preserved_segment: {
            head_uuid: "head",
            anchor_uuid: "anchor",
            tail_uuid: "tail",
          },
        },
      },
    ],
    base,
  );

  assert.deepEqual(
    events.map((event) => event.type),
    ["session", "compaction"],
  );
  assert.deepEqual(events[1].payload, {
    trigger: "manual",
    pre_tokens: 81234,
    post_tokens: 12000,
    duration_ms: 4321,
    preserved_segment: {
      head_uuid: "head",
      anchor_uuid: "anchor",
      tail_uuid: "tail",
    },
  });
});

test("normalizes Agent SDK tool_result blocks emitted on user messages", () => {
  const events = normalizeClaudeEvents(
    [
      { type: "system", subtype: "init", session_id: "s" },
      {
        type: "assistant",
        session_id: "s",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-1",
              name: "Read",
              input: { file_path: "fixture.txt" },
            },
          ],
        },
      },
      {
        type: "user",
        session_id: "s",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-1",
              content: "fixture contents",
              is_error: false,
            },
          ],
        },
      },
    ],
    base,
  );

  assert.deepEqual(
    events.map((event) => event.type),
    ["session", "tool_use", "tool_result"],
  );
  assert.equal(events[2].payload.tool_use_id, "tu-1");
  assert.equal(events[2].payload.output, "fixture contents");
  assert.equal(events[2].payload.is_error, false);
});

test("bounds oversized tool_result text without changing ordinary tool semantics", () => {
  const huge = "x".repeat(100_000);
  const events = normalizeClaudeEvents(
    [
      { type: "system", subtype: "init", session_id: "s" },
      {
        type: "user",
        session_id: "s",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "tu-large-text",
            content: huge,
            is_error: false,
          }],
        },
      },
    ],
    base,
  );

  const payload = events[1].payload;
  assert.equal(payload.tool_use_id, "tu-large-text");
  assert.equal(payload.is_error, false);
  assert.equal(payload.output.length, 24_000);
  assert.equal(payload.output_truncated, true);
  assert.equal("output_binary_omitted" in payload, false);
});

test("omits base64 image/blob bytes from tool_result while preserving useful metadata and references", () => {
  const imageBytes = Buffer.alloc(90_000, 7);
  const imageBase64 = imageBytes.toString("base64");
  const blobBytes = Buffer.alloc(12_345, 9);
  const blobBase64 = blobBytes.toString("base64");

  const events = normalizeClaudeEvents(
    [
      { type: "system", subtype: "init", session_id: "s" },
      {
        type: "user",
        session_id: "s",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "tu-image",
            is_error: false,
            content: [
              {
                type: "text",
                text: "image inspected",
              },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: imageBase64,
                },
              },
              {
                type: "resource",
                resource: {
                  uri: "file:///tmp/result.bin",
                  mimeType: "application/octet-stream",
                  blob: blobBase64,
                },
              },
            ],
          }],
        },
      },
    ],
    base,
  );

  const payload = events[1].payload;
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes(imageBase64.slice(0, 64)), false);
  assert.equal(serialized.includes(blobBase64.slice(0, 64)), false);
  assert.equal(payload.output_binary_omitted, true);
  assert.equal(payload.omitted_binary_items, 2);
  assert.equal(payload.omitted_binary_bytes, 102_345);
  assert.equal(payload.output[0].text, "image inspected");
  assert.deepEqual(payload.output[1].source, {
    type: "base64",
    media_type: "image/png",
    encoding: "base64",
    omitted: true,
    byte_length: 90_000,
  });
  assert.equal(
    payload.output[2].resource.uri,
    "file:///tmp/result.bin",
  );
  assert.deepEqual(payload.output[2].resource.blob, {
    encoding: "base64",
    omitted: true,
    byte_length: 12_345,
  });
  assert.ok(serialized.length < 8_000);
});

test("omits base64 data URLs from tool_result projections", () => {
  const binary = Buffer.alloc(4_096, 4).toString("base64");
  const events = normalizeClaudeEvents(
    [
      { type: "system", subtype: "init", session_id: "s" },
      {
        type: "assistant",
        session_id: "s",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "tu-data-url",
            content: `data:image/jpeg;base64,${binary}`,
            is_error: false,
          }],
        },
      },
    ],
    base,
  );

  assert.deepEqual(events[1].payload.output, {
    type: "binary_omitted",
    encoding: "base64",
    media_type: "image/jpeg",
    byte_length: 4_096,
  });
  assert.equal(events[1].payload.output_binary_omitted, true);
  assert.equal(events[1].payload.omitted_binary_bytes, 4_096);
});

test("unknown and conflicting-session events are surfaced without crashing", () => {
  const events = normalizeClaudeEvents([{ type: "system", subtype: "init", session_id: "s" }, { type: "future", subtype: "x", session_id: "s" }, { type: "assistant", session_id: "other", message: { content: [] } }], base);
  assert.equal(events[1].type, "runtime"); assert.equal(events[2].type, "error");
});


test("stateful normalizer preserves sequence and partial accumulation across streamed raw events", () => {
  let nextId = 0;
  let nextTime = 0;
  const normalizer = new ClaudeEventNormalizer({
    ...base,
    createId: () => `event-${++nextId}`,
    now: () => `2026-09-21T00:00:0${nextTime++}.000Z`,
  });

  const first = normalizer.normalize({ type: "system", subtype: "init", session_id: "stream-1" });
  const second = normalizer.normalize({ type: "assistant", session_id: "stream-1", delta: { text: "hel" } });
  const third = normalizer.normalize({ type: "assistant", session_id: "stream-1", delta: { text: "lo" } });
  const fourth = normalizer.normalize({ type: "result", session_id: "stream-1", result: "hello" });
  const events = [...first, ...second, ...third, ...fourth];

  assert.deepEqual(events.map((event) => event.type), ["session", "partial_text", "partial_text", "result"]);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3, 4]);
  assert.deepEqual(events.slice(1, 3).map((event) => event.payload.accumulated_length), [3, 5]);
  assert.deepEqual(events.map((event) => event.event_id), ["event-1", "event-2", "event-3", "event-4"]);
});


test("normalizes Agent SDK task lifecycle and background task level signals without local paths", () => {
  const events = normalizeClaudeEvents(
    [
      { type: "system", subtype: "init", session_id: "s" },
      {
        type: "system",
        subtype: "task_started",
        session_id: "s",
        task_id: "task-1",
        tool_use_id: "tool-1",
        description: "inspect repository",
        subagent_type: "Explore",
        task_type: "local_agent",
        ambient: false,
      },
      {
        type: "system",
        subtype: "task_progress",
        session_id: "s",
        task_id: "task-1",
        description: "reading files",
        usage: {
          total_tokens: 1200,
          tool_uses: 4,
          duration_ms: 2500,
        },
        last_tool_name: "Read",
        summary: "Found the target module",
      },
      {
        type: "system",
        subtype: "task_updated",
        session_id: "s",
        task_id: "task-1",
        patch: {
          status: "running",
          is_backgrounded: true,
          error: "/private/local/path should not persist",
        },
      },
      {
        type: "system",
        subtype: "background_tasks_changed",
        session_id: "s",
        tasks: [{
          task_id: "task-1",
          task_type: "local_agent",
          description: "inspect repository",
        }],
      },
      {
        type: "system",
        subtype: "task_notification",
        session_id: "s",
        task_id: "task-1",
        tool_use_id: "tool-1",
        status: "completed",
        output_file: "/private/local/task-output.txt",
        summary: "Repository inspection complete",
        usage: {
          total_tokens: 2400,
          tool_uses: 8,
          duration_ms: 5000,
        },
      },
    ],
    base,
  );

  assert.deepEqual(
    events.map((event) => event.type),
    ["session", "task", "task", "task", "task", "task"],
  );
  assert.deepEqual(
    events.slice(1).map((event) => event.payload.phase),
    [
      "started",
      "progress",
      "updated",
      "active_set",
      "notification",
    ],
  );
  assert.deepEqual(events[2].payload.usage, {
    total_tokens: 1200,
    tool_uses: 4,
    duration_ms: 2500,
  });
  assert.equal(events[3].payload.patch.has_error, true);
  assert.equal("error" in events[3].payload.patch, false);
  assert.deepEqual(events[4].payload, {
    phase: "active_set",
    replace: true,
    tasks: [{
      task_id: "task-1",
      task_type: "local_agent",
      description: "inspect repository",
      ambient: false,
    }],
  });
  assert.equal(events[5].payload.has_output_file, true);
  assert.equal("output_file" in events[5].payload, false);
});
