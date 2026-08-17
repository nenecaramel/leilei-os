import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { env } from "../../config/env.js";
import {
  NotionExplicitWriteError,
  NotionExplicitWriteService,
  type NotionExplicitWriteResult,
} from "../../domains/notion/notion-explicit-write-service.js";
import {
  notionAuthErrorResult,
  notionBodySchema,
  notionErrorResult,
  notionIdSchema,
  notionOutputSchema,
  notionSuccess,
  NotionWriteAuthenticationError,
} from "../tools/notion-write-shared.js";

export type NotionExplicitWriteServiceContract = {
  createPage(body: Record<string, unknown>): Promise<NotionExplicitWriteResult>;
  updatePage(pageId: string, body: Record<string, unknown>): Promise<NotionExplicitWriteResult>;
  updatePageContent(pageId: string, body: Record<string, unknown>): Promise<NotionExplicitWriteResult>;
  createComment(pageId: string, body: Record<string, unknown>): Promise<NotionExplicitWriteResult>;
  replyComment(
    pageId: string,
    discussionId: string,
    body: Record<string, unknown>,
  ): Promise<NotionExplicitWriteResult>;
};

export type NotionExplicitWriteToolsDependencies = {
  notionService: NotionExplicitWriteServiceContract;
  getAuthenticatedUserId: () => string;
};

const pageInputSchema = z.object({
  action: z.enum(["create", "update", "update_content"]),
  page_id: notionIdSchema.optional(),
  body: notionBodySchema.optional(),
  parent: notionBodySchema.optional(),
}).strict();

const commentInputSchema = z.object({
  action: z.enum(["create", "reply"]),
  page_id: notionIdSchema,
  discussion_id: notionIdSchema.optional(),
  body: notionBodySchema,
}).strict();

function explicitWriteErrorResult(error: NotionExplicitWriteError) {
  const text = error.code === "UNCERTAIN_WRITE"
    ? "The Notion write outcome is uncertain. Fresh readback was attempted and the write was not retried."
    : error.code === "INVALID_WRITE"
      ? "The requested Notion change is outside the allowed explicit-write surface."
      : "The Notion write completed but fresh readback verification failed.";
  return {
    isError: true as const,
    content: [{ type: "text" as const, text }],
  };
}

function invalidActionInput(toolName: string) {
  return {
    isError: true as const,
    content: [{
      type: "text" as const,
      text: `The ${toolName} request is invalid for the selected action.`,
    }],
  };
}

function handleWriteError(error: unknown) {
  if (error instanceof NotionWriteAuthenticationError) return notionAuthErrorResult();
  if (error instanceof NotionExplicitWriteError) return explicitWriteErrorResult(error);
  return notionErrorResult(error);
}

export function registerNotionExplicitWriteTools(
  server: McpServer,
  dependencies: NotionExplicitWriteToolsDependencies,
): void {
  server.registerTool(
    "write_notion_page",
    {
      title: "Write Notion page",
      description:
        "Explicitly create a Notion page, update page properties, or update page content. Each operation fresh-reads before writing and verifies with fresh readback. Destructive page actions are not available.",
      inputSchema: pageInputSchema,
      outputSchema: notionOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        if (args.action === "create") {
          if (!args.body) return invalidActionInput("write_notion_page");
          const body = args.parent ? { ...args.body, parent: args.parent } : args.body;
          dependencies.getAuthenticatedUserId();
          const result = await dependencies.notionService.createPage(body);
          return notionSuccess(result, `Created and verified Notion page ${result.target_id}.`);
        }

        if (!args.page_id || !args.body) return invalidActionInput("write_notion_page");
        dependencies.getAuthenticatedUserId();

        if (args.action === "update") {
          const result = await dependencies.notionService.updatePage(args.page_id, args.body);
          return notionSuccess(result, `Updated and verified Notion page ${result.target_id}.`);
        }

        const result = await dependencies.notionService.updatePageContent(args.page_id, args.body);
        return notionSuccess(result, `Updated and verified Notion page content ${result.target_id}.`);
      } catch (error) {
        return handleWriteError(error);
      }
    },
  );

  server.registerTool(
    "write_notion_comment",
    {
      title: "Write Notion comment",
      description:
        "Explicitly create a page comment or reply to an existing discussion. Each operation fresh-reads the target page and verifies the created comment with fresh readback. Comment update and delete are not available.",
      inputSchema: commentInputSchema,
      outputSchema: notionOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        if (args.action === "reply" && !args.discussion_id) {
          return invalidActionInput("write_notion_comment");
        }
        dependencies.getAuthenticatedUserId();

        if (args.action === "create") {
          const result = await dependencies.notionService.createComment(args.page_id, args.body);
          return notionSuccess(result, `Created and verified Notion comment ${result.target_id}.`);
        }

        const result = await dependencies.notionService.replyComment(
          args.page_id,
          args.discussion_id as string,
          args.body,
        );
        return notionSuccess(result, `Created and verified Notion comment reply ${result.target_id}.`);
      } catch (error) {
        return handleWriteError(error);
      }
    },
  );
}

let productionService: NotionExplicitWriteService | undefined;

function getProductionService(): NotionExplicitWriteService {
  if (!productionService) productionService = new NotionExplicitWriteService(env.NOTION_PAT);
  return productionService;
}

export function registerProductionNotionExplicitWriteTools(
  server: McpServer,
  authenticatedUserId: string | undefined,
): void {
  registerNotionExplicitWriteTools(server, {
    notionService: getProductionService(),
    getAuthenticatedUserId: () => {
      if (!authenticatedUserId) throw new NotionWriteAuthenticationError();
      return authenticatedUserId;
    },
  });
}
