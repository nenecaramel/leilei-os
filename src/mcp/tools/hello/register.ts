import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const helloInputSchema = {
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe("Optional name to include in the greeting."),
};

const helloOutputSchema = {
  success: z.boolean(),
  data: z.object({
    message: z.string(),
    server: z.string(),
    timestamp: z.string().datetime(),
  }),
};

export function registerHelloTool(server: McpServer): void {
  server.registerTool(
    "hello",
    {
      title: "Check Leilei OS connectivity",
      description:
        "Read-only connectivity check for the Leilei OS MCP server. Use it to verify that ChatGPT can reach and invoke this remote server. It does not read or modify personal data.",
      inputSchema: helloInputSchema,
      outputSchema: helloOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name }) => {
      const result = {
        success: true,
        data: {
          message: name ? `Hello, ${name}!` : "Hello from Leilei OS!",
          server: "leilei-os",
          timestamp: new Date().toISOString(),
        },
      };

      return {
        content: [{ type: "text", text: result.data.message }],
        structuredContent: result,
      };
    },
  );
}
