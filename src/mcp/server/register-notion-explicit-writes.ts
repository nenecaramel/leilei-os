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
import {
  notionPageContentUpdateBodySchema,
  notionPageCreateBodySchema,
  notionPageParentSchema,
  notionPageUpdateBodySchema,
} from "../../domains/notion/notion-explicit-write-schema.js";
import {
  authorizeNotionUser,
  isActiveUserAuthorizationError,
} from "./notion-authorization.js";

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
  requireActiveUser?: () => Promise<string>;
};

const pageInputSchema = z.object({
  action: z.enum(["create", "update", "update_content"]).describe(
    "Select one action: create requires body; update and update_content require page_id and body.",
  ),
  page_id: notionIdSchema.optional().describe(
    "Required for update and update_content; forbidden for create.",
  ),
  body: z.union([
    notionPageCreateBodySchema,
    notionPageUpdateBodySchema,
    notionPageContentUpdateBodySchema,
  ]).optional().describe(
    "Required for create, update, and update_content; its shape selects the requested operation body.",
  ),
  parent: notionPageParentSchema.optional().describe(
    "Optional for create only; forbidden for update and update_content.",
  ),
}).strict();

const pageActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    body: notionPageCreateBodySchema,
    parent: notionPageParentSchema.optional(),
  }).strict(),
  z.object({
    action: z.literal("update"),
    page_id: notionIdSchema,
    body: notionPageUpdateBodySchema,
  }).strict(),
  z.object({
    action: z.literal("update_content"),
    page_id: notionIdSchema,
    body: notionPageContentUpdateBodySchema,
  }).strict(),
]);

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
  if (isActiveUserAuthorizationError(error)) {
    return notionAuthErrorResult();
  }
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
        "Explicitly create a Notion page, update page properties, or update page content. Shapes: create={action,body,parent?}; update={action,page_id,body}; update_content={action,page_id,body}. page_id and body are required where shown; parent is create-only. Each operation fresh-reads before writing and verifies with fresh readback. Destructive page actions are not available.",
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
        const parsed = pageActionSchema.safeParse(args);
        if (!parsed.success) return invalidActionInput("write_notion_page");
        const actionArgs = parsed.data;

        if (actionArgs.action === "create") {
          const body = actionArgs.parent
            ? { ...actionArgs.body, parent: actionArgs.parent }
            : actionArgs.body;
          await authorizeNotionUser(dependencies);
          const result = await dependencies.notionService.createPage(body);
          return notionSuccess(result, `Created and verified Notion page ${result.target_id}.`);
        }

        await authorizeNotionUser(dependencies);

        if (actionArgs.action === "update") {
          const result = await dependencies.notionService.updatePage(actionArgs.page_id, actionArgs.body);
          return notionSuccess(result, `Updated and verified Notion page ${result.target_id}.`);
        }

        const result = await dependencies.notionService.updatePageContent(actionArgs.page_id, actionArgs.body);
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
        await authorizeNotionUser(dependencies);

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
  requireActiveUser?: () => Promise<string>,
): void {
  registerNotionExplicitWriteTools(server, {
    notionService: getProductionService(),
    getAuthenticatedUserId: () => {
      if (!authenticatedUserId) throw new NotionWriteAuthenticationError();
      return authenticatedUserId;
    },
    requireActiveUser,
  });
}
