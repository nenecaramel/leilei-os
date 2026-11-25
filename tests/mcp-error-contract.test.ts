import assert from "node:assert/strict";
import test from "node:test";
import {
  createMcpToolError,
  mcpToolErrorStructuredContentSchema,
} from "../src/mcp/tools/error-contract.js";

test("shared MCP tool error helper emits the strict machine-readable envelope", () => {
  const result = createMcpToolError(
    "INTERNAL_ERROR",
    "Tool is temporarily unavailable.",
  );

  assert.equal(result.isError, true);
  assert.deepEqual(result.content, [
    { type: "text", text: "Tool is temporarily unavailable." },
  ]);
  assert.deepEqual(
    mcpToolErrorStructuredContentSchema.parse(result.structuredContent),
    {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Tool is temporarily unavailable.",
      },
    },
  );
  assert.throws(() =>
    mcpToolErrorStructuredContentSchema.parse({
      ...result.structuredContent,
      unexpected: true,
    }),
  );
});
