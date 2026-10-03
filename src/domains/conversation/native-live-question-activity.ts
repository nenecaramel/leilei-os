import type { NativeLiveContentBlockInput } from "./native-live-conversation-types.js";

type QuestionResolutionSource = {
  kind: string;
  status: string;
  request: unknown;
  response: unknown;
};

/** Preserve only question resolution truth; the request already lives in tool_use.input. */
export function withCanonicalQuestionActivity(
  blocks: readonly NativeLiveContentBlockInput[],
  interactions: readonly QuestionResolutionSource[],
): NativeLiveContentBlockInput[] {
  const questionIds = new Set(blocks
    .filter((block) => block.kind === "tool_use" && block.payload?.tool_name === "AskUserQuestion")
    .map((block) => block.payload?.tool_use_id)
    .filter((id): id is string => typeof id === "string"));
  const resultIds = new Set(blocks
    .filter((block) => block.kind === "tool_result")
    .map((block) => block.payload?.tool_use_id));
  const traces = new Map<string, Record<string, unknown>>();
  for (const interaction of interactions) {
    if (interaction.kind !== "question" || interaction.status === "pending") continue;
    const request = record(interaction.request);
    const id = request?.toolUseId ?? request?.tool_use_id;
    if (typeof id !== "string" || !questionIds.has(id)) continue;
    const response = record(interaction.response);
    if (interaction.status === "cancelled" || response?.decision === "cancel") {
      traces.set(id, {
        kind: "question",
        resolution: "cancelled",
        ...(typeof response?.message === "string" ? { message: response.message } : {}),
      });
    } else if (interaction.status === "resolved" && response?.decision === "answer") {
      const answers = record(response.answers);
      if (!answers || !Object.keys(answers).length || !Object.values(answers).every((answer) => typeof answer === "string")) continue;
      traces.set(id, { kind: "question", resolution: "answered", answers });
    }
  }
  return blocks.map((block) => {
    const id = block.payload?.tool_use_id;
    const trace = typeof id === "string" ? traces.get(id) : undefined;
    if (!trace || (block.kind !== "tool_result" && !(block.kind === "tool_use" && !resultIds.has(id)))) return block;
    return { ...block, payload: { ...block.payload, question_activity: trace } };
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
