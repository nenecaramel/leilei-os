import { ChatGPTExportParser } from "./chatgpt-export-parser.js";
import { ClaudeExportParser } from "./claude-export-parser.js";
import type { ConversationProvider } from "./conversation-types.js";
import type { ConversationProviderParser } from "./provider-parser.js";

const REGISTRY: ReadonlyArray<{
  parser: ConversationProviderParser;
  version: string;
}> = [
  { parser: ChatGPTExportParser, version: "chatgpt-v1" },
  { parser: ClaudeExportParser, version: "claude-v1" },
];

export function detectConversationProviderParser(
  value: unknown,
): {
  parser: ConversationProviderParser;
  provider: ConversationProvider;
  version: string;
} {
  const matches = REGISTRY.filter(({ parser }) => parser.canParseConversation(value));
  if (matches.length !== 1) {
    throw Object.assign(new Error("Conversation export provider is not recognized."), {
      code: "CONVERSATION_IMPORT_PROVIDER_UNKNOWN",
    });
  }
  const match = matches[0]!;
  return {
    parser: match.parser,
    provider: match.parser.provider,
    version: match.version,
  };
}
