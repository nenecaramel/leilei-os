import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  SDK_EVENT_SURFACES,
  boundedOutput,
  provenance,
} from "../src/output-contract.mjs";

const require = createRequire(import.meta.url);
const sdkRoot = dirname(require.resolve("@anthropic-ai/claude-agent-sdk"));

test("inventory covers installed SDKMessage discriminators and provenance matches SDK version", () => {
  const manifest = JSON.parse(
    readFileSync(join(sdkRoot, "package.json"), "utf8"),
  );
  assert.equal(
    provenance({ type: "assistant" }).provider_schema,
    `claude-agent-sdk/${manifest.version}`,
  );
  const sdk = readFileSync(join(sdkRoot, "sdk.d.ts"), "utf8");
  const union = sdk
    .match(/export declare type SDKMessage = ([^;]+);/)[1]
    .split("|")
    .map((x) => x.trim());
  for (const name of union) {
    const body = sdk.match(
      new RegExp(
        "export declare type " + name + " = ([\\s\\S]*?)(?=export declare|$)",
      ),
    )?.[1];
    if (!body) continue;
    const type = body.match(/type: '([^']+)'/)?.[1];
    const subtype = body.match(/subtype: '([^']+)'/)?.[1];
    if (!type) continue; // SDKResultMessage alias is covered by result-level contract tests.
    const key = type === "system" ? `${type}/${subtype}` : type;
    assert.ok(
      SDK_EVENT_SURFACES[key],
      `${name}: ${key} requires inventory review`,
    );
  }
});

test("compatibility envelope bounds adversarial breadth and JSON serialization", () => {
  const raw = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [
      "k".repeat(127) + i,
      Array.from({ length: 100 }, () => ({
        text: "x".repeat(10000),
        thinking: "SECRET",
      })),
    ]),
  );
  const result = boundedOutput(raw);
  assert.ok(JSON.stringify(result).length < 64000);
  assert.equal(result.truncated, true);
  assert.ok(!JSON.stringify(result).includes("SECRET"));
});

test("execution projection also bounds broad numeric trees and long object keys", async () => {
  const { normalizeClaudeEvents } =
    await import("../src/normalized-events.mjs");
  const tree = Array.from({ length: 32 }, () =>
    Array.from({ length: 32 }, () =>
      Array.from({ length: 32 }, () => ({ ["k".repeat(10000)]: 42 })),
    ),
  );
  const events = normalizeClaudeEvents(
    [
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "t", content: tree }],
        },
      },
    ],
    { logicalConversationId: "c", mode: "new" },
  );
  assert.ok(JSON.stringify(events).length < 150000);
  assert.equal(events[0].payload.output_truncated, true);
});

test("clipped key collisions remain bounded without crashing or overwriting", async () => {
  const raw = {
    ["x".repeat(116) + ":2"]: 0,
    ["x".repeat(128) + "a"]: 1,
    ["x".repeat(128) + "b"]: 2,
  };
  const result = boundedOutput(raw);
  assert.deepEqual(Object.values(result.payload), [0, 1, 2]);
  assert.equal(result.truncated, true);
  const { normalizeClaudeEvents } =
    await import("../src/normalized-events.mjs");
  assert.doesNotThrow(() =>
    normalizeClaudeEvents(
      [
        {
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "t", content: raw }],
          },
        },
      ],
      { logicalConversationId: "c", mode: "new" },
    ),
  );
});

test("ordinary structured data strings are not mistaken for binary fields", async () => {
  assert.equal(
    boundedOutput({ data: "business text" }).payload.data,
    "business text",
  );
  const { normalizeClaudeEvents } =
    await import("../src/normalized-events.mjs");
  const events = normalizeClaudeEvents(
    [
      {
        type: "result",
        result: "",
        structured_output: {
          data: "business text",
          file: { type: "base64", media_type: "application/pdf", data: "AQID" },
        },
      },
    ],
    { logicalConversationId: "c", mode: "new" },
  );
  assert.equal(
    events[0].payload.structured_output.payload.data,
    "business text",
  );
  assert.ok(!JSON.stringify(events).includes("AQID"));
});
