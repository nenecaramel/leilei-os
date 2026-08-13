import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { env } from "../../config/env.js";
import { NotionCommentClient } from "../../domains/notion/notion-comment-client.js";
import { NotionFileUploadClient } from "../../domains/notion/notion-file-upload-client.js";
import { NotionPageBlockClient } from "../../domains/notion/notion-page-block-client.js";
import { NotionStructureClient } from "../../domains/notion/notion-structure-client.js";
import { NotionTransport } from "../../domains/notion/notion-transport.js";
import { registerUploadNotionFileTool, type UploadNotionFileToolDependencies } from "../tools/upload-notion-file/register.js";
import { notionBodySchema, notionIdSchema, NotionWriteAuthenticationError } from "../tools/notion-write-shared.js";
import { registerWriteNotionBlockTool, type WriteNotionBlockToolDependencies } from "../tools/write-notion-block/register.js";
import { registerWriteNotionCommentTool, type WriteNotionCommentToolDependencies } from "../tools/write-notion-comment/register.js";
import { registerWriteNotionDatabaseTool, type WriteNotionDatabaseToolDependencies } from "../tools/write-notion-database/register.js";
import { registerWriteNotionDataSourceTool, type WriteNotionDataSourceToolDependencies } from "../tools/write-notion-data-source/register.js";
import { registerWriteNotionPageTool, type WriteNotionPageToolDependencies } from "../tools/write-notion-page/register.js";
import { registerWriteNotionViewTool, type WriteNotionViewToolDependencies } from "../tools/write-notion-view/register.js";

type NotionWriteService =
  WriteNotionPageToolDependencies["notionService"] &
  WriteNotionBlockToolDependencies["notionService"] &
  WriteNotionDatabaseToolDependencies["notionService"] &
  WriteNotionDataSourceToolDependencies["notionService"] &
  WriteNotionViewToolDependencies["notionService"] &
  WriteNotionCommentToolDependencies["notionService"] &
  UploadNotionFileToolDependencies["notionService"];

export type NotionWriteToolsDependencies = {
  notionService: NotionWriteService;
  getAuthenticatedUserId: () => string;
};

let defaultTransport: NotionTransport | undefined;
let defaultPageBlockClient: NotionPageBlockClient | undefined;
let defaultStructureClient: NotionStructureClient | undefined;
let defaultCommentClient: NotionCommentClient | undefined;
let defaultFileUploadClient: NotionFileUploadClient | undefined;

function getDefaultTransport(): NotionTransport {
  if (!defaultTransport) defaultTransport = new NotionTransport(env.NOTION_PAT);
  return defaultTransport;
}

function getDefaultPageBlockClient(): NotionPageBlockClient {
  if (!defaultPageBlockClient) {
    defaultPageBlockClient = new NotionPageBlockClient(getDefaultTransport());
  }
  return defaultPageBlockClient;
}

function getDefaultStructureClient(): NotionStructureClient {
  if (!defaultStructureClient) {
    defaultStructureClient = new NotionStructureClient(getDefaultTransport());
  }
  return defaultStructureClient;
}

function getDefaultCommentClient(): NotionCommentClient {
  if (!defaultCommentClient) {
    defaultCommentClient = new NotionCommentClient(getDefaultTransport());
  }
  return defaultCommentClient;
}

function getDefaultFileUploadClient(): NotionFileUploadClient {
  if (!defaultFileUploadClient) {
    defaultFileUploadClient = new NotionFileUploadClient(getDefaultTransport());
  }
  return defaultFileUploadClient;
}

const productionNotionWriteService: NotionWriteService = {
  createPage: (body) => getDefaultPageBlockClient().createPage(body),
  updatePage: (pageId, body) => getDefaultPageBlockClient().updatePage(pageId, body),
  movePage: (pageId, parent) => getDefaultPageBlockClient().movePage(pageId, parent),
  updatePageMarkdown: (pageId, body) => getDefaultPageBlockClient().updatePageMarkdown(pageId, body),
  appendBlockChildren: (blockId, body) => getDefaultPageBlockClient().appendBlockChildren(blockId, body),
  updateBlock: (blockId, body) => getDefaultPageBlockClient().updateBlock(blockId, body),
  deleteBlock: (blockId) => getDefaultPageBlockClient().deleteBlock(blockId),
  createDatabase: (body) => getDefaultStructureClient().createDatabase(body),
  updateDatabase: (databaseId, body) => getDefaultStructureClient().updateDatabase(databaseId, body),
  createDataSource: (body) => getDefaultStructureClient().createDataSource(body),
  updateDataSource: (dataSourceId, body) => getDefaultStructureClient().updateDataSource(dataSourceId, body),
  createView: (body) => getDefaultStructureClient().createView(body),
  updateView: (viewId, body) => getDefaultStructureClient().updateView(viewId, body),
  deleteView: (viewId) => getDefaultStructureClient().deleteView(viewId),
  createComment: (body) => getDefaultCommentClient().createComment(body),
  updateComment: (commentId, body) => getDefaultCommentClient().updateComment(commentId, body),
  deleteComment: (commentId) => getDefaultCommentClient().deleteComment(commentId),
  createUpload: (body) => getDefaultFileUploadClient().createUpload(body),
  sendUpload: (fileUploadId, file, filename, partNumber) =>
    getDefaultFileUploadClient().sendUpload(fileUploadId, file, filename, partNumber),
  completeUpload: (fileUploadId) => getDefaultFileUploadClient().completeUpload(fileUploadId),
};

const notionWritePublicInputSchemas: Record<string, z.ZodTypeAny> = {
  write_notion_page: z.object({
    action: z.enum(["create", "update", "move", "update_content", "trash", "restore"]),
    page_id: notionIdSchema.optional(),
    body: notionBodySchema.optional(),
    parent: notionBodySchema.optional(),
  }).strict(),
  write_notion_block: z.object({
    action: z.enum(["append_children", "insert_children", "update", "delete", "restore"]),
    block_id: notionIdSchema,
    body: notionBodySchema.optional(),
  }).strict(),
  write_notion_database: z.object({
    action: z.enum(["create", "update", "trash", "restore"]),
    database_id: notionIdSchema.optional(),
    body: notionBodySchema.optional(),
  }).strict(),
  write_notion_data_source: z.object({
    action: z.enum(["create", "update", "trash", "restore"]),
    data_source_id: notionIdSchema.optional(),
    body: notionBodySchema.optional(),
  }).strict(),
  write_notion_view: z.object({
    action: z.enum(["create", "update", "delete"]),
    view_id: notionIdSchema.optional(),
    body: notionBodySchema.optional(),
  }).strict(),
  write_notion_comment: z.object({
    action: z.enum(["create", "reply", "update", "delete"]),
    discussion_id: notionIdSchema.optional(),
    comment_id: notionIdSchema.optional(),
    body: notionBodySchema.optional(),
  }).strict(),
  upload_notion_file: z.object({
    action: z.enum(["create", "send", "complete"]),
    body: notionBodySchema.optional(),
    file_upload_id: notionIdSchema.optional(),
    filename: z.string().trim().min(1).max(900).optional(),
    content_type: z.string().trim().min(1).max(200).optional(),
    file_base64: z.string().min(1).max(28_000_000).optional(),
    part_number: z.number().int().min(1).max(1000).optional(),
  }).strict(),
};

function createNotionWriteSchemaCompatibleServer(server: McpServer): McpServer {
  const registerTool = server.registerTool.bind(server) as (
    name: string,
    config: Record<string, unknown> & { inputSchema?: z.ZodTypeAny },
    callback: (args: unknown, extra: unknown) => unknown,
  ) => unknown;

  return new Proxy(server, {
    get(target, property, receiver) {
      if (property !== "registerTool") return Reflect.get(target, property, receiver);

      return (
        name: string,
        config: Record<string, unknown> & { inputSchema?: z.ZodTypeAny },
        callback: (args: unknown, extra: unknown) => unknown,
      ) => {
        const publicSchema = notionWritePublicInputSchemas[name];
        const strictSchema = config.inputSchema;
        if (!publicSchema || !strictSchema) {
          return registerTool(name, config, callback);
        }

        return registerTool(
          name,
          { ...config, inputSchema: publicSchema },
          async (args, extra) => {
            const parsed = await strictSchema.safeParseAsync(args);
            if (!parsed.success) {
              return {
                isError: true as const,
                content: [{
                  type: "text" as const,
                  text: `The ${name} request is invalid for the selected action.`,
                }],
              };
            }
            return await callback(parsed.data, extra);
          },
        );
      };
    },
  });
}

export function registerNotionWriteTools(
  server: McpServer,
  dependencies: NotionWriteToolsDependencies,
): void {
  const compatibleServer = createNotionWriteSchemaCompatibleServer(server);
  registerWriteNotionPageTool(compatibleServer, dependencies);
  registerWriteNotionBlockTool(compatibleServer, dependencies);
  registerWriteNotionDatabaseTool(compatibleServer, dependencies);
  registerWriteNotionDataSourceTool(compatibleServer, dependencies);
  registerWriteNotionViewTool(compatibleServer, dependencies);
  registerWriteNotionCommentTool(compatibleServer, dependencies);
  registerUploadNotionFileTool(compatibleServer, dependencies);
}

export function registerProductionNotionWriteTools(
  server: McpServer,
  authenticatedUserId: string | undefined,
): void {
  registerNotionWriteTools(server, {
    notionService: productionNotionWriteService,
    getAuthenticatedUserId: () => {
      if (!authenticatedUserId) throw new NotionWriteAuthenticationError();
      return authenticatedUserId;
    },
  });
}
