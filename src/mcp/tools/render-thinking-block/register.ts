import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CHATGPT_RENDER_THINKING_BLOCK_RESOURCE_URI,
  CHATGPT_RENDER_WORKING_NOTE_RESOURCE_URI,
  RENDER_THINKING_BLOCK_RESOURCE_URI,
  RENDER_WORKING_NOTE_RESOURCE_URI,
} from "./resource.js";

const workingNoteStyleSchema = z.enum(["analysis", "relational"]);
const workingNoteDetailSchema = z.enum(["brief", "standard", "detailed"]);

export const renderWorkingNoteInputSchema = z.object({
  style: workingNoteStyleSchema.describe(
    "Choose the user-visible note style. Use analysis for concise public reasoning summaries, evidence, assumptions, options, and next steps; use relational for user-visible interpersonal context or feelings without exposing private chain-of-thought.",
  ),
  note: z.string().describe(
    "User-visible working note. Include only information that is appropriate to show directly to the user, such as conclusions, evidence, assumptions, options, uncertainties, and next steps. Do not output private chain-of-thought, hidden reasoning, internal scratchpad content, or a transcript of unrevealed intermediate reasoning.",
  ),
  detail: workingNoteDetailSchema.describe(
    "How much user-visible detail to show: brief for a compact note, standard for normal context, detailed for a fuller public-facing explanation. This controls note presentation only and is not a hidden reasoning-effort setting.",
  ),
}).strict();

const legacyStyleSchema = z.enum(["deep_think", "relational"]);
const legacyEffortSchema = z.enum(["low", "medium", "high"]);
const legacySkinSchema = z.enum(["botanical", "microglow"]);

const advertisedLegacyInputSchema = z.object({
  style: legacyStyleSchema.describe(
    "Legacy display style retained only for cached clients. Prefer render_working_note.",
  ),
  thinking: z.string().describe(
    "Legacy user-visible working text. This is not hidden chain-of-thought. Prefer render_working_note(note=...).",
  ),
  effort: legacyEffortSchema.describe(
    "Legacy display-length hint retained only for cached clients. Prefer render_working_note(detail=...).",
  ),
}).strict();

const legacyCompatibleInputSchema = advertisedLegacyInputSchema.extend({
  skin: legacySkinSchema.optional(),
}).strict();

export const renderThinkingBlockInputSchema = advertisedLegacyInputSchema;
renderThinkingBlockInputSchema._parse = (input) => legacyCompatibleInputSchema._parse(input);

const renderWorkingNoteOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({ status: z.literal("rendered") }).strict(),
}).strict();

const WORKING_NOTE_DESCRIPTION =
  "Render a user-visible working note in the LeileiOS MCP App before continuing the normal answer. The note is explicit display content supplied to this tool; it is not hidden reasoning, private chain-of-thought, or a request to reveal internal scratchpad content. Use it only when a visible intermediate note materially helps the user.";

const LEGACY_DESCRIPTION =
  "DEPRECATED: use render_working_note. This legacy alias renders user-visible working text for cached clients and must not be treated as access to hidden reasoning or chain-of-thought.";

export function registerRenderWorkingNoteTool(server: McpServer): void {
  registerAppTool(
    server,
    "render_working_note",
    {
      title: "Render working note",
      description: WORKING_NOTE_DESCRIPTION,
      inputSchema: renderWorkingNoteInputSchema,
      outputSchema: renderWorkingNoteOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          resourceUri: RENDER_WORKING_NOTE_RESOURCE_URI,
          visibility: ["model", "app"] as ["model", "app"],
        },
        "openai/outputTemplate": CHATGPT_RENDER_WORKING_NOTE_RESOURCE_URI,
        "openai/toolInvocation/invoking": "正在渲染工作笔记…",
        "openai/toolInvocation/invoked": "工作笔记已渲染",
      },
    },
    async ({ style, note, detail }) => ({
      content: [{ type: "text", text: "Working note rendered." }],
      structuredContent: {
        success: true as const,
        data: { status: "rendered" as const },
      },
      _meta: { style, note, detail },
    }),
  );
}

export function registerRenderThinkingBlockTool(server: McpServer): void {
  registerAppTool(
    server,
    "render_thinking_block",
    {
      title: "Deprecated: render working note",
      description: LEGACY_DESCRIPTION,
      inputSchema: renderThinkingBlockInputSchema,
      outputSchema: renderWorkingNoteOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          resourceUri: RENDER_THINKING_BLOCK_RESOURCE_URI,
          visibility: ["model", "app"] as ["model", "app"],
        },
        "openai/outputTemplate": CHATGPT_RENDER_THINKING_BLOCK_RESOURCE_URI,
        "openai/toolInvocation/invoking": "正在渲染兼容工作笔记…",
        "openai/toolInvocation/invoked": "兼容工作笔记已渲染",
      },
    },
    async ({ style, thinking, effort }) => ({
      content: [{ type: "text", text: "Legacy working note rendered." }],
      structuredContent: {
        success: true as const,
        data: { status: "rendered" as const },
      },
      _meta: { style, thinking, effort },
    }),
  );
}
