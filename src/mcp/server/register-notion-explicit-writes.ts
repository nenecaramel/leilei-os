import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { env } from "../../config/env.js";
import {
  NotionExplicitWriteError,
  NotionExplicitWriteService,
  type NotionExplicitWriteResult,
} from "../../domains/notion/notion-explicit-write-service.js";
import {
  notionBodySchema,
  notionIdSchema,
  notionWriteError,
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
import {
  mcpMutationReceipt,
  mcpMutationReceiptFields,
} from "../tools/mutation-contract.js";
import {
  createMcpToolError,
  mcpErrorRecoveryHint,
  mcpToolErrorDetailsSchema,
} from "../tools/error-contract.js";

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

const explicitReceiptOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    operation: z.string().min(1),
    target_id: z.string().min(1),
    verified: z.literal(true),
    discussion_id: z.string().nullable().optional(),
    ...mcpMutationReceiptFields,
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

function explicitWriteErrorResult(
  error: NotionExplicitWriteError,
  pageId?: string,
) {
  const message = error.code === "UNCERTAIN_WRITE"
    ? "The Notion write outcome is uncertain. Fresh readback was attempted and the write was not retried."
    : error.code === "INVALID_WRITE"
      ? "The requested Notion change is outside the allowed explicit-write surface."
      : "The Notion write completed but fresh readback verification failed.";

  if (error.code === "UNCERTAIN_WRITE") {
    return createMcpToolError(
      error.code,
      message,
      message,
      mcpErrorRecoveryHint({
        retryable: false,
        reason: "uncertain_outcome",
        recommendedTool: pageId ? "read_notion_page" : null,
        recommendedArguments: pageId ? { page_id: pageId } : null,
      }),
    );
  }
  return createMcpToolError(error.code, message);
}

function invalidActionInput(toolName: string) {
  return createMcpToolError(
    "INVALID_ARGUMENT",
    `The ${toolName} request is invalid for the selected action.`,
  );
}

function handleWriteError(error: unknown, pageId?: string) {
  if (
    isActiveUserAuthorizationError(error)
    || error instanceof NotionWriteAuthenticationError
  ) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to modify Notion.",
    );
  }
  if (error instanceof NotionExplicitWriteError) {
    return explicitWriteErrorResult(error, pageId);
  }
  return createMcpToolError(
    "NOTION_WRITE_FAILED",
    notionWriteError(error),
  );
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
        "Advanced explicit-payload Notion page write. Prefer typed Notion tools when they fit. Supports create, update, and update_content; fresh-read verified.",
      inputSchema: pageInputSchema,
      outputSchema: explicitReceiptOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      let recoveryPageId: string | undefined;
      try {
        const parsed = pageActionSchema.safeParse(args);
        if (!parsed.success) return invalidActionInput("write_notion_page");
        const actionArgs = parsed.data;
        recoveryPageId = actionArgs.action === "create"
          ? undefined
          : actionArgs.page_id;

        if (actionArgs.action === "create") {
          const body = actionArgs.parent
            ? { ...actionArgs.body, parent: actionArgs.parent }
            : actionArgs.body;
          await authorizeNotionUser(dependencies);
          const result = await dependencies.notionService.createPage(body);
          return explicitSuccess(
            result,
            "notion_page",
            result.target_id,
            result.target_id,
            `Created and verified Notion page ${result.target_id}.`,
          );
        }

        await authorizeNotionUser(dependencies);

        if (actionArgs.action === "update") {
          const result = await dependencies.notionService.updatePage(actionArgs.page_id, actionArgs.body);
          return explicitSuccess(
            result,
            "notion_page",
            result.target_id,
            actionArgs.page_id,
            `Updated and verified Notion page ${result.target_id}.`,
          );
        }

        const result = await dependencies.notionService.updatePageContent(actionArgs.page_id, actionArgs.body);
        return explicitSuccess(
          result,
          "notion_page",
          result.target_id,
          actionArgs.page_id,
          `Updated and verified Notion page content ${result.target_id}.`,
        );
      } catch (error) {
        return handleWriteError(error, recoveryPageId);
      }
    },
  );

  server.registerTool(
    "write_notion_comment",
    {
      title: "Write Notion comment",
      description:
        "Advanced explicit-payload Notion comment write. Prefer typed comment tools when they fit. Fresh-read verified.",
      inputSchema: commentInputSchema,
      outputSchema: explicitReceiptOutputSchema,
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
          return explicitSuccess(
            result,
            "notion_comment",
            result.target_id,
            args.page_id,
            `Created and verified Notion comment ${result.target_id}.`,
          );
        }

        const result = await dependencies.notionService.replyComment(
          args.page_id,
          args.discussion_id as string,
          args.body,
        );
        return explicitSuccess(
          result,
          "notion_comment",
          result.target_id,
          args.page_id,
          `Created and verified Notion comment reply ${result.target_id}.`,
        );
      } catch (error) {
        return handleWriteError(error);
      }
    },
  );
}

function explicitSuccess(
  result: NotionExplicitWriteResult,
  entityType: "notion_page" | "notion_comment",
  entityId: string,
  pageId: string,
  text: string,
) {
  const data = {
    operation: result.operation,
    target_id: result.target_id,
    verified: true as const,
    ...(typeof result.discussion_id === "string" || result.discussion_id === null
      ? { discussion_id: result.discussion_id }
      : {}),
    ...mcpMutationReceipt({
      outcome: "applied",
      entity_type: entityType,
      entity_id: entityId,
      revision: null,
      detail_tool: entityType === "notion_comment" ? null : "read_notion_page",
      detail_arguments: entityType === "notion_comment"
        ? null
        : { page_id: pageId },
    }),
  };
  return {
    content: [{
      type: "text" as const,
      text: `${text} [operation=${data.operation}; target_id=${data.target_id}]`,
    }],
    structuredContent: {
      success: true as const,
      data,
    },
  };
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
