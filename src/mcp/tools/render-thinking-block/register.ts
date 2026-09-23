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
    "选择本轮思考块的文体。用户明确指定时严格服从；否则按本轮主要目的选择：分析、研究、判断、创作取舍和问题求解使用 deep_think，陪伴、亲密交流、情绪回应与个人感受使用 relational。",
  ),
  thinking: z.string().describe(
    "在这里写本轮外置的工作文本。它是用户可见的兼容字段，不是模型原生隐藏 CoT；旧客户端继续使用此字段，新调用请改用 render_working_note(note=...)。",
  ),
  effort: legacyEffortSchema.describe(
    "本轮兼容思考块的长度目标：low 最多约 500 tokens；medium 约 700–1000 tokens；high 约 1200–2000 tokens。新调用请改用 render_working_note(detail=...)。",
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
  "DEPRECATED: use render_working_note. 兼容旧客户端：把工具参数里的用户可见外置工作文本显示在 LeileiOS MCP App 中。它不是模型原生隐藏 CoT，也不提供任何 hidden reasoning / private chain-of-thought 访问。";

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
