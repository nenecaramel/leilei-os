import { z } from "zod";

export const MCP_CONTENT_AUTHOR_DESCRIPTION =
  "Author: L = 蕾蕾 / user, G = ChatGPT, C = Claude.";

export const mcpContentAuthorSchema = z.enum(["L", "G", "C"]);

export const TODO_DOMAIN_BOUNDARY =
  "Todo is a date-scoped paper of lightweight entries.";

export const DIARY_DOMAIN_BOUNDARY =
  "Diary stores dated authored journal entries.";

export const UNIVERSE_DOMAIN_BOUNDARY =
  "Universe is a graph of concepts, relations, and provenance.";
