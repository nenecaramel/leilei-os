import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NotionJsonObject } from "../../../domains/notion/notion-transport.js";
import {
  notionAuthErrorResult,
  notionBodySchema,
  notionErrorResult,
  notionOutputSchema,
  notionSuccess,
  NotionWriteAuthenticationError,
} from "../notion-write-shared.js";

const inputSchema = z.object({
  body: notionBodySchema,
}).strict();

export type CreateNotionMeetingNoteToolDependencies = {
  notionService: {
    createMeetingNote(body: NotionJsonObject): Promise<NotionJsonObject>;
  };
  getAuthenticatedUserId: () => string;
};

export function registerCreateNotionMeetingNoteTool(
  server: McpServer,
  dependencies: CreateNotionMeetingNoteToolDependencies,
): void {
  server.registerTool("create_notion_meeting_note", {
    title: "Create Notion meeting note",
    description: "Create a Notion AI Meeting Note from a supported source such as an uploaded audio/video file or existing meeting-note block. Requires workspace AI Meeting Notes availability and Notion write permission.",
    inputSchema,
    outputSchema: notionOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async (args) => {
    try {
      dependencies.getAuthenticatedUserId();
      const data = await dependencies.notionService.createMeetingNote(args.body);
      return notionSuccess(data, "Notion meeting note creation completed.");
    } catch (error) {
      if (error instanceof NotionWriteAuthenticationError) return notionAuthErrorResult();
      return notionErrorResult(error);
    }
  });
}
