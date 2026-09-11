import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CHATGPT_SHARED_PAPER_APP_RESOURCE_URI,
  SHARED_PAPER_APP_RESOURCE_URI,
} from "./resource.js";

const inputSchema = z.object({
  id: z.string().uuid().optional().describe("Optional Shared Paper id to open immediately."),
  scope: z.enum(["active", "archived"]).optional().describe("Initial browser scope. Defaults to active."),
}).strict();

const outputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    status: z.literal("opened"),
    paper_id: z.string().uuid().optional(),
    scope: z.enum(["active", "archived"]),
  }).strict(),
}).strict();

export function registerSharedPaperAppTool(server: McpServer): void {
  registerAppTool(
    server,
    "open_shared_paper_app",
    {
      title: "Open Shared Paper",
      description: "Open the LeileiOS Shared Paper MCP App for browsing, searching, reading, editing, history, archive, restore, and permanent delete. The App reuses the existing authoritative Shared Paper tools and revision CAS.",
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          resourceUri: SHARED_PAPER_APP_RESOURCE_URI,
          visibility: ["model", "app"] as ["model", "app"],
        },
        "openai/outputTemplate": CHATGPT_SHARED_PAPER_APP_RESOURCE_URI,
        "openai/toolInvocation/invoking": "正在打开 Shared Paper…",
        "openai/toolInvocation/invoked": "Shared Paper 已打开",
      },
    },
    async ({ id, scope }) => ({
      content: [{ type: "text" as const, text: "Shared Paper App opened." }],
      structuredContent: {
        success: true as const,
        data: {
          status: "opened" as const,
          ...(id ? { paper_id: id } : {}),
          scope: scope ?? "active",
        },
      },
    }),
  );
}
