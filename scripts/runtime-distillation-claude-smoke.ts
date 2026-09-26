import { ClaudeCodeDistillationModel } from "../src/domains/runtime/claude-code-distillation-model.js";

const { HeadlessClaudeTransport } = await import(
  "../tools/claude-bridge/src/headless-claude-transport.mjs"
);

const transport = new HeadlessClaudeTransport();
const model = new ClaudeCodeDistillationModel(transport);

const result = await model.distill({
  conversationId: "00000000-0000-4000-8000-000000000001",
  sourceHeadMessageId: "00000000-0000-4000-8000-000000000002",
  transcript: [
    {
      messageId: "00000000-0000-4000-8000-000000000003",
      role: "user",
      text: "今天我们把 LeileiOS 的 Distillation 接到真实 Claude Code。",
    },
    {
      messageId: "00000000-0000-4000-8000-000000000004",
      role: "assistant",
      text: "这一层只负责把已经成立的旧对话沉淀成 derived Memory，不改写 canonical。",
    },
    {
      messageId: "00000000-0000-4000-8000-000000000005",
      role: "user",
      text: "对，先验证真实模型输出和解析，background trigger 下一刀再接。",
    },
    {
      messageId: "00000000-0000-4000-8000-000000000006",
      role: "assistant",
      text: "会保持无工具、严格 JSON、失败不推进 watermark。",
    },
  ],
});

process.stdout.write(JSON.stringify(result, null, 2) + "\n");
