import { z } from "zod";

export const MCP_CONTENT_AUTHOR_DESCRIPTION =
  "Author: L=蕾蕾/user, G=ChatGPT, C=Claude.";

export const mcpContentAuthorSchema = z.enum(["L", "G", "C"]);

export const TODO_DOMAIN_BOUNDARY =
  "Todo: dated lightweight entries.";

export const DIARY_DOMAIN_BOUNDARY =
  "Diary: dated journal entries.";

export const UNIVERSE_DOMAIN_BOUNDARY =
  "Universe: concept graph with relations and provenance.";
