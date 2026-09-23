import { z } from "zod";

export const MCP_CONTENT_AUTHOR_DESCRIPTION =
  "Logical content author: L = 蕾蕾 / user, G = ChatGPT, C = Claude.";

export const mcpContentAuthorSchema = z.enum(["L", "G", "C"]);

export const TASK_DOMAIN_BOUNDARY =
  "Task is a durable actionable item with status, priority, and optional due time; it is not a date-scoped Todo paper or Todo entry.";

export const TODO_DOMAIN_BOUNDARY =
  "Todo is a date-scoped paper of lightweight entries; it is not the Task system for durable actionable items.";

export const MEMORY_DOMAIN_BOUNDARY =
  "Memory stores durable distilled facts, preferences, goals, and projects; it is not a dated Diary entry.";

export const DIARY_DOMAIN_BOUNDARY =
  "Diary stores dated authored journal entries; it is not distilled Memory.";

export const UNIVERSE_DOMAIN_BOUNDARY =
  "Universe is a graph of conceptual nodes, relations, and provenance; it is not a Shared Paper document.";

export const SHARED_PAPER_DOMAIN_BOUNDARY =
  "Shared Paper is a canonical long-form document with edit history; it is not the Universe graph.";
