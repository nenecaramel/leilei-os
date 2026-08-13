import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { env } from "../../config/env.js";
import { NotionCommentClient } from "../../domains/notion/notion-comment-client.js";
import { NotionFileUploadClient } from "../../domains/notion/notion-file-upload-client.js";
import { NotionPageBlockClient } from "../../domains/notion/notion-page-block-client.js";
import { NotionStructureClient } from "../../domains/notion/notion-structure-client.js";
import { NotionTransport } from "../../domains/notion/notion-transport.js";
import { registerUploadNotionFileTool, type UploadNotionFileToolDependencies } from "../tools/upload-notion-file/register.js";
import { NotionWriteAuthenticationError } from "../tools/notion-write-shared.js";
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
  createComment: (body) => getDefaultCommentClient().createComment(body),
  updateComment: (commentId, body) => getDefaultCommentClient().updateComment(commentId, body),
  createUpload: (body) => getDefaultFileUploadClient().createUpload(body),
  sendUpload: (fileUploadId, file, filename, partNumber) =>
    getDefaultFileUploadClient().sendUpload(fileUploadId, file, filename, partNumber),
  completeUpload: (fileUploadId) => getDefaultFileUploadClient().completeUpload(fileUploadId),
};

export function registerNotionWriteTools(
  server: McpServer,
  dependencies: NotionWriteToolsDependencies,
): void {
  registerWriteNotionPageTool(server, dependencies);
  registerWriteNotionBlockTool(server, dependencies);
  registerWriteNotionDatabaseTool(server, dependencies);
  registerWriteNotionDataSourceTool(server, dependencies);
  registerWriteNotionViewTool(server, dependencies);
  registerWriteNotionCommentTool(server, dependencies);
  registerUploadNotionFileTool(server, dependencies);
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
