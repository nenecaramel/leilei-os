import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { env } from "../../config/env.js";
import {
  NotionExplicitWriteError,
  NotionExplicitWriteService,
  type NotionExplicitWriteResult,
} from "../../domains/notion/notion-explicit-write-service.js";
import {
  authorizeNotionUser,
  isActiveUserAuthorizationError,
} from "./notion-authorization.js";
import {
  notionIdSchema,
  notionWriteError,
  NotionWriteAuthenticationError,
} from "../tools/notion-write-shared.js";
import {
  createMcpToolError,
  mcpErrorRecoveryHint,
  mcpToolErrorDetailsSchema,
} from "../tools/error-contract.js";
import {
  mcpMutationReceipt,
  mcpMutationReceiptFields,
} from "../tools/mutation-contract.js";

const MAX_TYPED_PROPERTY_TEXT_CODE_POINTS = 20_000;
const MAX_TYPED_COMMENT_CODE_POINTS = 2_000;
const MAX_TYPED_MARKDOWN_LENGTH = 250_000;
const RICH_TEXT_CHUNK_CODE_POINTS = 2_000;

const propertyNameSchema = z.string().trim().min(1).max(200);
const typedTextSchema = z.string().refine(
  (value) => Array.from(value.normalize("NFC")).length <= MAX_TYPED_PROPERTY_TEXT_CODE_POINTS,
  `Text must not exceed ${MAX_TYPED_PROPERTY_TEXT_CODE_POINTS} Unicode code points.`,
);
const typedTitleSchema = typedTextSchema.refine(
  (value) => value.trim().length > 0,
  "Title must not be empty.",
);
const commentTextSchema = z.string().refine(
  (value) => {
    const normalized = value.normalize("NFC").trim();
    return normalized.length > 0
      && Array.from(normalized).length <= MAX_TYPED_COMMENT_CODE_POINTS;
  },
  `Comment text must contain content and must not exceed ${MAX_TYPED_COMMENT_CODE_POINTS} Unicode code points.`,
);
const markdownSchema = z.string().max(MAX_TYPED_MARKDOWN_LENGTH).refine(
  (value) => value.trim().length > 0,
  "Markdown content must not be empty.",
);

const typedParentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("page"), id: notionIdSchema }).strict(),
  z.object({ type: z.literal("database"), id: notionIdSchema }).strict(),
  z.object({ type: z.literal("data_source"), id: notionIdSchema }).strict(),
  z.object({ type: z.literal("workspace") }).strict(),
]);

const dateValueSchema = z.object({
  start: z.string().trim().min(1).max(100),
  end: z.string().trim().min(1).max(100).nullable().optional(),
  time_zone: z.string().trim().min(1).max(100).nullable().optional(),
}).strict();

const typedPropertySchema = z.discriminatedUnion("type", [
  z.object({
    name: propertyNameSchema,
    type: z.literal("title"),
    value: typedTitleSchema,
  }).strict(),
  z.object({
    name: propertyNameSchema,
    type: z.literal("rich_text"),
    value: typedTextSchema,
  }).strict(),
  z.object({
    name: propertyNameSchema,
    type: z.literal("number"),
    value: z.number().finite().nullable(),
  }).strict(),
  z.object({
    name: propertyNameSchema,
    type: z.literal("checkbox"),
    value: z.boolean(),
  }).strict(),
  z.object({
    name: propertyNameSchema,
    type: z.literal("date"),
    value: dateValueSchema.nullable(),
  }).strict(),
  z.object({
    name: propertyNameSchema,
    type: z.literal("select"),
    value: z.string().trim().min(1).max(200).nullable(),
  }).strict(),
  z.object({
    name: propertyNameSchema,
    type: z.literal("multi_select"),
    value: z.array(z.string().trim().min(1).max(200)).max(100),
  }).strict(),
  z.object({
    name: propertyNameSchema,
    type: z.literal("status"),
    value: z.string().trim().min(1).max(200).nullable(),
  }).strict(),
  z.object({
    name: propertyNameSchema,
    type: z.literal("url"),
    value: z.string().trim().url().max(2_000).nullable(),
  }).strict(),
  z.object({
    name: propertyNameSchema,
    type: z.literal("email"),
    value: z.string().trim().email().max(320).nullable(),
  }).strict(),
  z.object({
    name: propertyNameSchema,
    type: z.literal("phone_number"),
    value: z.string().trim().min(1).max(200).nullable(),
  }).strict(),
  z.object({
    name: propertyNameSchema,
    type: z.literal("relation"),
    value: z.array(notionIdSchema).max(100),
  }).strict(),
]);

const createPageInputSchema = z.object({
  parent: typedParentSchema,
  title: typedTitleSchema,
  title_property: propertyNameSchema.default("title").optional().describe(
    "Name of the title property. Defaults to title; set this for database/data-source parents whose title property uses another name.",
  ),
  properties: z.array(typedPropertySchema).max(50).default([]).optional(),
}).strict();

const updatePropertiesInputSchema = z.object({
  page_id: notionIdSchema,
  properties: z.array(typedPropertySchema).min(1).max(50),
}).strict();

const pageContentInputSchema = z.object({
  page_id: notionIdSchema,
  markdown: markdownSchema,
}).strict();

const addCommentInputSchema = z.object({
  page_id: notionIdSchema,
  text: commentTextSchema,
}).strict();

const replyCommentInputSchema = z.object({
  page_id: notionIdSchema,
  discussion_id: notionIdSchema,
  text: commentTextSchema,
}).strict();

const receiptDataSchema = z.object({
  operation: z.string().min(1),
  target_id: z.string().min(1),
  page_id: z.string().min(1),
  verified: z.literal(true),
  discussion_id: z.string().nullable().optional(),
  ...mcpMutationReceiptFields,
}).strict();

const receiptOutputSchema = z.object({
  success: z.boolean(),
  data: receiptDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

type TypedParent = z.infer<typeof typedParentSchema>;
type TypedProperty = z.infer<typeof typedPropertySchema>;

export type NotionTypedWriteServiceContract = {
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

export type NotionTypedWriteToolsDependencies = {
  notionService: NotionTypedWriteServiceContract;
  getAuthenticatedUserId: () => string;
  requireActiveUser?: () => Promise<string>;
};

class NotionTypedInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotionTypedInputError";
  }
}

export function registerNotionTypedWriteTools(
  server: McpServer,
  dependencies: NotionTypedWriteToolsDependencies,
): void {
  server.registerTool(
    "create_notion_page",
    {
      title: "Create Notion page",
      description:
        "Create a Notion page from typed parent, title, and properties. Add body content separately. Fresh-read verified.",
      inputSchema: createPageInputSchema,
      outputSchema: receiptOutputSchema,
      annotations: notionTypedWriteAnnotations,
    },
    async ({ parent, title, title_property = "title", properties = [] }) => {
      try {
        await authorizeNotionUser(dependencies);
        if (properties.some((property) => property.type === "title")) {
          throw new NotionTypedInputError(
            "create_notion_page uses title/title_property for the title; do not add another title property.",
          );
        }
        const body = {
          parent: toNotionParent(parent),
          properties: buildTypedProperties(properties, {
            [title_property]: { title: toRichText(title) },
          }),
        };
        const result = await dependencies.notionService.createPage(body);
        return pageReceipt(result, result.target_id, "Created and verified Notion page.");
      } catch (error) {
        return typedWriteError(error);
      }
    },
  );

  server.registerTool(
    "update_notion_page_properties",
    {
      title: "Update Notion page properties",
      description:
        "Update selected Notion page properties with typed values. Fresh-read verified.",
      inputSchema: updatePropertiesInputSchema,
      outputSchema: receiptOutputSchema,
      annotations: notionTypedWriteAnnotations,
    },
    async ({ page_id, properties }) => {
      try {
        await authorizeNotionUser(dependencies);
        const result = await dependencies.notionService.updatePage(page_id, {
          properties: buildTypedProperties(properties),
        });
        return pageReceipt(result, page_id, "Updated and verified Notion page properties.");
      } catch (error) {
        return typedWriteError(error, page_id);
      }
    },
  );

  server.registerTool(
    "append_notion_page_content",
    {
      title: "Append Notion page content",
      description:
        "Append Markdown content to one exact Notion page. Fresh-read verified.",
      inputSchema: pageContentInputSchema,
      outputSchema: receiptOutputSchema,
      annotations: notionTypedWriteAnnotations,
    },
    async ({ page_id, markdown }) => {
      try {
        await authorizeNotionUser(dependencies);
        const result = await dependencies.notionService.updatePageContent(page_id, {
          type: "insert_content",
          insert_content: { content: markdown },
        });
        return pageReceipt(result, page_id, "Appended and verified Notion page content.");
      } catch (error) {
        return typedWriteError(error, page_id);
      }
    },
  );

  server.registerTool(
    "replace_notion_page_content",
    {
      title: "Replace Notion page content",
      description:
        "Replace the complete Markdown body of one exact Notion page. Use append_notion_page_content to preserve existing content. Fresh-read verified.",
      inputSchema: pageContentInputSchema,
      outputSchema: receiptOutputSchema,
      annotations: {
        ...notionTypedWriteAnnotations,
        destructiveHint: true,
      },
    },
    async ({ page_id, markdown }) => {
      try {
        await authorizeNotionUser(dependencies);
        const result = await dependencies.notionService.updatePageContent(page_id, {
          type: "replace_content",
          replace_content: { new_str: markdown },
        });
        return pageReceipt(result, page_id, "Replaced and verified Notion page content.");
      } catch (error) {
        return typedWriteError(error, page_id);
      }
    },
  );

  server.registerTool(
    "add_notion_comment",
    {
      title: "Add Notion comment",
      description:
        "Add one plain-text comment to an exact Notion page. Fresh-read verified.",
      inputSchema: addCommentInputSchema,
      outputSchema: receiptOutputSchema,
      annotations: notionTypedWriteAnnotations,
    },
    async ({ page_id, text }) => {
      try {
        await authorizeNotionUser(dependencies);
        const result = await dependencies.notionService.createComment(page_id, {
          rich_text: toRichText(text.normalize("NFC").trim()),
        });
        return pageReceipt(result, page_id, "Created and verified Notion comment.");
      } catch (error) {
        return typedWriteError(error);
      }
    },
  );

  server.registerTool(
    "reply_notion_comment",
    {
      title: "Reply to Notion comment discussion",
      description:
        "Reply with plain text to one Notion discussion. Fresh-read verified.",
      inputSchema: replyCommentInputSchema,
      outputSchema: receiptOutputSchema,
      annotations: notionTypedWriteAnnotations,
    },
    async ({ page_id, discussion_id, text }) => {
      try {
        await authorizeNotionUser(dependencies);
        const result = await dependencies.notionService.replyComment(
          page_id,
          discussion_id,
          { rich_text: toRichText(text.normalize("NFC").trim()) },
        );
        return pageReceipt(result, page_id, "Created and verified Notion comment reply.");
      } catch (error) {
        return typedWriteError(error);
      }
    },
  );
}

const notionTypedWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

function toNotionParent(parent: TypedParent): Record<string, unknown> {
  switch (parent.type) {
    case "page":
      return { type: "page_id", page_id: parent.id };
    case "database":
      return { type: "database_id", database_id: parent.id };
    case "data_source":
      return { type: "data_source_id", data_source_id: parent.id };
    case "workspace":
      return { type: "workspace", workspace: true };
  }
}

function buildTypedProperties(
  properties: readonly TypedProperty[],
  initial: Record<string, unknown> = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...initial };
  const seen = new Set(Object.keys(initial));
  for (const property of properties) {
    if (seen.has(property.name)) {
      throw new NotionTypedInputError(
        `Notion property ${JSON.stringify(property.name)} was supplied more than once.`,
      );
    }
    seen.add(property.name);
    result[property.name] = toNotionProperty(property);
  }
  return result;
}

function toNotionProperty(property: TypedProperty): Record<string, unknown> {
  switch (property.type) {
    case "title":
      return { title: toRichText(property.value) };
    case "rich_text":
      return { rich_text: toRichText(property.value) };
    case "number":
      return { number: property.value };
    case "checkbox":
      return { checkbox: property.value };
    case "date":
      return {
        date: property.value === null
          ? null
          : {
              start: property.value.start,
              end: property.value.end ?? null,
              time_zone: property.value.time_zone ?? null,
            },
      };
    case "select":
      return { select: property.value === null ? null : { name: property.value } };
    case "multi_select":
      return { multi_select: property.value.map((name) => ({ name })) };
    case "status":
      return { status: property.value === null ? null : { name: property.value } };
    case "url":
      return { url: property.value };
    case "email":
      return { email: property.value };
    case "phone_number":
      return { phone_number: property.value };
    case "relation":
      return { relation: property.value.map((id) => ({ id })) };
  }
}

function toRichText(value: string): Array<Record<string, unknown>> {
  const points = Array.from(value.normalize("NFC"));
  if (points.length === 0) return [];
  const chunks: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < points.length; offset += RICH_TEXT_CHUNK_CODE_POINTS) {
    chunks.push({
      type: "text",
      text: {
        content: points.slice(offset, offset + RICH_TEXT_CHUNK_CODE_POINTS).join(""),
      },
    });
  }
  return chunks;
}

function pageReceipt(
  result: NotionExplicitWriteResult,
  pageId: string,
  text: string,
) {
  const isComment = result.operation.startsWith("comment.");
  const data = {
    operation: result.operation,
    target_id: result.target_id,
    page_id: pageId,
    verified: true as const,
    ...(typeof result.discussion_id === "string" || result.discussion_id === null
      ? { discussion_id: result.discussion_id }
      : {}),
    ...mcpMutationReceipt({
      outcome: "applied",
      entity_type: isComment ? "notion_comment" : "notion_page",
      entity_id: result.target_id,
      revision: null,
      detail_tool: isComment ? null : "read_notion_page",
      detail_arguments: isComment ? null : { page_id: pageId },
    }),
  };
  return {
    content: [{
      type: "text" as const,
      text: `${text} [operation=${data.operation}; target_id=${data.target_id}; page_id=${pageId}]`,
    }],
    structuredContent: {
      success: true as const,
      data,
    },
  };
}

function typedWriteError(error: unknown, pageId?: string) {
  if (
    error instanceof NotionWriteAuthenticationError
    || isActiveUserAuthorizationError(error)
  ) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to modify Notion.",
    );
  }
  if (error instanceof NotionTypedInputError) {
    return createMcpToolError(
      "INVALID_ARGUMENT",
      error.message,
    );
  }
  if (error instanceof NotionExplicitWriteError) {
    const message = error.code === "UNCERTAIN_WRITE"
      ? "The Notion write outcome is uncertain. Fresh readback was attempted and the write was not retried."
      : error.code === "INVALID_WRITE"
        ? "The requested Notion change is outside the allowed verified write surface."
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
  return createMcpToolError(
    "NOTION_WRITE_FAILED",
    notionWriteError(error),
  );
}

let productionService: NotionExplicitWriteService | undefined;

function getProductionService(): NotionExplicitWriteService {
  if (!productionService) {
    productionService = new NotionExplicitWriteService(env.NOTION_PAT);
  }
  return productionService;
}

export function registerProductionNotionTypedWriteTools(
  server: McpServer,
  authenticatedUserId: string | undefined,
  requireActiveUser?: () => Promise<string>,
): void {
  registerNotionTypedWriteTools(server, {
    notionService: getProductionService(),
    getAuthenticatedUserId: () => {
      if (!authenticatedUserId) throw new NotionWriteAuthenticationError();
      return authenticatedUserId;
    },
    requireActiveUser,
  });
}
