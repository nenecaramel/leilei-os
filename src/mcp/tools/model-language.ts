import { z } from "zod";

export const MCP_CONTENT_AUTHOR_DESCRIPTION =
  "Author: L = 蕾蕾 / user, G = ChatGPT, C = Claude.";

export const mcpContentAuthorSchema = z.enum(["L", "G", "C"]);

export const TASK_DOMAIN_BOUNDARY =
  "Task is a durable actionable item with status, priority, and optional due time; not a date-scoped Todo.";

export const TODO_DOMAIN_BOUNDARY =
  "Todo is a date-scoped paper of lightweight entries; not the Task system.";

export const MEMORY_DOMAIN_BOUNDARY =
  "Memory stores durable distilled facts, preferences, goals, and projects; not a dated Diary.";

export const DIARY_DOMAIN_BOUNDARY =
  "Diary stores dated authored journal entries; not distilled Memory.";

export const UNIVERSE_DOMAIN_BOUNDARY =
  "Universe is a graph of concepts, relations, and provenance; not a Shared Paper.";

export const SHARED_PAPER_DOMAIN_BOUNDARY =
  "Shared Paper is a canonical long-form document with edit history; not the Universe graph.";
