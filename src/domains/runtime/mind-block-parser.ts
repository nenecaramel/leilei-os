import type { NativeLiveContentBlockInput } from "../conversation/native-live-conversation-types.js";
import {
  parseMindWriteIntents,
  type CurrentMindWriteIntent,
} from "./mind-intent-parser.js";

export type ParsedAssistantBlocks = {
  visibleBlocks: NativeLiveContentBlockInput[];
  intents: CurrentMindWriteIntent[];
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

  for (const block of blocks) {
    if (block.kind !== "text" || !block.text) {
      visibleBlocks.push({ ...block });
      continue;
    }

    const parsed = parseMindWriteIntents(block.text);
    intents.push(...parsed.intents);

    if (parsed.visibleText) {
      visibleBlocks.push({
        ...block,
        text: parsed.visibleText,
      });
    }
  }

  return { visibleBlocks, intents };
}
