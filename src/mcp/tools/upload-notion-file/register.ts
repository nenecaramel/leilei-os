import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NotionJsonObject } from "../../../domains/notion/notion-transport.js";
import {
  notionAuthErrorResult,
  notionBodySchema,
  notionErrorResult,
  notionIdSchema,
  notionOutputSchema,
  notionSuccess,
  NotionWriteAuthenticationError,
} from "../notion-write-shared.js";

const base64Schema = z
  .string()
  .min(1)
  .max(28_000_000)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, "file_base64 must be standard base64.");

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), body: notionBodySchema }).strict(),
  z.object({
    action: z.literal("send"),
    file_upload_id: notionIdSchema,
    filename: z.string().trim().min(1).max(900),
    content_type: z.string().trim().min(1).max(200),
    file_base64: base64Schema,
    part_number: z.number().int().min(1).max(1000).optional(),
  }).strict(),
  z.object({ action: z.literal("complete"), file_upload_id: notionIdSchema }).strict(),
]);

export type UploadNotionFileToolDependencies = {
  notionService: {
    createUpload(body: NotionJsonObject): Promise<NotionJsonObject>;
    sendUpload(
      fileUploadId: string,
      file: Blob,
      filename: string,
      partNumber?: number,
    ): Promise<NotionJsonObject>;
    completeUpload(fileUploadId: string): Promise<NotionJsonObject>;
  };
  getAuthenticatedUserId: () => string;
};

export function registerUploadNotionFileTool(
  server: McpServer,
  dependencies: UploadNotionFileToolDependencies,
): void {
  server.registerTool("upload_notion_file", {
    title: "Upload file to Notion",
    description: "Create a Notion file upload, send a single or multipart base64-decoded file payload, or complete a multipart upload. External-URL imports are supported through the create body.",
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
      let data: NotionJsonObject;
      switch (args.action) {
        case "create":
          data = await dependencies.notionService.createUpload(args.body);
          break;
        case "send": {
          const bytes = Buffer.from(args.file_base64, "base64");
          const file = new Blob([bytes], { type: args.content_type });
          data = await dependencies.notionService.sendUpload(
            args.file_upload_id,
            file,
            args.filename,
            args.part_number,
          );
          break;
        }
        case "complete":
          data = await dependencies.notionService.completeUpload(args.file_upload_id);
          break;
      }
      return notionSuccess(data, `Notion file upload ${args.action} completed.`);
    } catch (error) {
      if (error instanceof NotionWriteAuthenticationError) return notionAuthErrorResult();
      return notionErrorResult(error);
    }
  });
}
