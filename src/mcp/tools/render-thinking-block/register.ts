import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CHATGPT_RENDER_THINKING_BLOCK_RESOURCE_URI,
  RENDER_THINKING_BLOCK_RESOURCE_URI,
} from "./resource.js";

const styleSchema = z.enum(["deep_think", "relational"]);
const effortSchema = z.enum(["low", "medium", "high"]);
const skinSchema = z.enum(["botanical", "microglow"]);

export const renderThinkingBlockInputSchema = z.object({
  style: styleSchema.describe(
    "选择本轮思考块的文体。用户明确指定时严格服从；否则按本轮主要目的选择：分析、研究、判断、创作取舍和问题求解使用 deep_think，陪伴、亲密交流、情绪回应与个人感受使用 relational。",
  ),
  thinking: z.string().describe(
    "在这里写本轮外置的工作文本。它不是最终回答，也不是模型原生隐藏 CoT。使用用户本轮的主要语言；严格按照 style 写作。style=deep_think：清楚展开问题、约束、证据、假设、备选路径、不确定性与取舍，写成连贯的分析叙述。style=relational：使用第一人称、自然流动且连贯的长段落，写出联想、感受、担心、克制与正在作出的取舍，不要写成第三人称的用户分析报告。这里是临时、可推翻的工作材料，最终回答不必保留其中的每个判断；旧 block 只属于当时回合，除非用户明确要求，否则不得在以后引用、继承其中的猜测，或把它当作权威记忆。",
  ),
  effort: effortSchema.describe(
    "本轮思考块的长度目标：low 最多约 500 tokens；medium 约 700–1000 tokens；high 约 1200–2000 tokens。这里只是 prompt-level 目标，不做静默截断；不要为了凑长度重复或虚构复杂性。",
  ),
  skin: skinSchema.describe(
    "本轮卡片的视觉皮肤。botanical 是温暖的纸张、鼠尾草、杏仁与杏色；microglow 是珍珠白、澄澈青蓝、薰衣草冰、薄荷雾与玻璃般的晨光。",
  ),
}).strict();

const renderThinkingBlockOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({ status: z.literal("rendered") }).strict(),
}).strict();

const TOOL_DESCRIPTION =
  "在正式回答前，把模型主动写入的外置工作文本显示在 LeileiOS MCP Apps 思考卡片中，然后继续正常回答。卡片内容不是模型原生隐藏 CoT，而是本次工具参数中的文本；它默认不落盘，也不会自动成为长期记忆。遇到不简单的问题时按本轮内容选择合适的 style、effort 和 skin，不需要每一轮调用。";

export function registerRenderThinkingBlockTool(server: McpServer): void {
  registerAppTool(
    server,
    "render_thinking_block",
    {
      title: "渲染思考块",
      description: TOOL_DESCRIPTION,
      inputSchema: renderThinkingBlockInputSchema,
      outputSchema: renderThinkingBlockOutputSchema,
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
        "openai/toolInvocation/invoking": "正在渲染思考块…",
        "openai/toolInvocation/invoked": "思考块已渲染",
      },
    },
    async ({ style, thinking, effort, skin }) => ({
      content: [{ type: "text", text: "Thinking block rendered." }],
      structuredContent: {
        success: true as const,
        data: { status: "rendered" as const },
      },
      _meta: { style, thinking, effort, skin },
    }),
  );
}
