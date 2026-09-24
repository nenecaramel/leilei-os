import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CHATGPT_RENDER_NOTE_CARD_RESOURCE_URI,
  RENDER_NOTE_CARD_RESOURCE_URI,
} from "./resource.js";

const noteStyleSchema = z.enum(["analysis", "relational"]);
const noteDetailSchema = z.enum(["brief", "standard", "detailed"]);

export const renderNoteCardInputSchema = z.object({
  style: noteStyleSchema.describe(
    "Card style: analysis for explanation or general observation; relational for personal or interpersonal content.",
  ),
  note: z.string().trim().min(1).describe(
    "Card text written directly for the user.",
  ),
  detail: noteDetailSchema.describe(
    "Card length: brief, standard, or detailed.",
  ),
}).strict();

const renderNoteCardOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({ status: z.literal("rendered") }).strict(),
}).strict();

export function registerRenderNoteCardTool(server: McpServer): void {
  registerAppTool(
    server,
    "render_note_card",
    {
      title: "Render note card",
      description:
        "Display an assistant-written observation, explanation, relational note, or next step as a LeileiOS card.",
      inputSchema: renderNoteCardInputSchema,
      outputSchema: renderNoteCardOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          resourceUri: RENDER_NOTE_CARD_RESOURCE_URI,
          visibility: ["model", "app"] as ["model", "app"],
        },
        "openai/outputTemplate": CHATGPT_RENDER_NOTE_CARD_RESOURCE_URI,
        "openai/toolInvocation/invoking": "正在渲染卡片…",
        "openai/toolInvocation/invoked": "卡片已渲染",
      },
    },
    async ({ style, note, detail }) => ({
      content: [{ type: "text", text: "Note card rendered." }],
      structuredContent: {
        success: true as const,
        data: { status: "rendered" as const },
      },
      _meta: { style, note, detail },
    }),
  );
}
