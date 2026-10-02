import type { NativeLiveContentBlockInput } from "../../conversation/native-live-conversation-types.js";
import {
  parseMindWriteIntents,
  type CurrentMindWriteIntent,
} from "./mind-intent-parser.js";
import {
  parseMindSemanticActions,
  type MindSemanticAction,
} from "./mind-semantic-action.js";

export type ParsedAssistantBlocks = {
  visibleBlocks: NativeLiveContentBlockInput[];
  intents: CurrentMindWriteIntent[];
  actions?: MindSemanticAction[];
};

/**
 * Parses only complete canonical text blocks. Bridge partial_text events are
 * never fed here, so an incomplete streamed tag cannot create subject state.
 */
export function parseMindWriteIntentsFromBlocks(
  blocks: readonly NativeLiveContentBlockInput[],
): ParsedAssistantBlocks {
  const visibleBlocks: NativeLiveContentBlockInput[] = [];
  const intents: CurrentMindWriteIntent[] = [];
  const actions: MindSemanticAction[] = [];

  for (const block of blocks) {
    if (block.kind !== "text" || !block.text) {
      visibleBlocks.push({ ...block });
      continue;
    }

    const parsedWrites = parseMindWriteIntents(block.text);
    intents.push(...parsedWrites.intents);
    const parsedActions = parseMindSemanticActions(parsedWrites.visibleText);
    actions.push(...parsedActions.actions);

    if (parsedActions.visibleText) {
      visibleBlocks.push({
        ...block,
        text: parsedActions.visibleText,
      });
    }
  }

  return { visibleBlocks, intents, actions };
}
