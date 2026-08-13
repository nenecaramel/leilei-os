import type { NotionJsonObject } from "./notion-transport.js";
import { NotionTransport } from "./notion-transport.js";

export class NotionFileUploadClient {
  constructor(private readonly transport: NotionTransport) {}

  createUpload(body: NotionJsonObject): Promise<NotionJsonObject> {
    return this.transport.requestJson("/file_uploads", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  sendUpload(
    fileUploadId: string,
    file: Blob,
    filename: string,
    partNumber?: number,
  ): Promise<NotionJsonObject> {
    const form = new FormData();
    form.append("file", file, filename);
    if (partNumber !== undefined) form.append("part_number", String(partNumber));
    return this.transport.requestJson(
      `/file_uploads/${encodeURIComponent(fileUploadId)}/send`,
      {
        method: "POST",
        body: form,
      },
    );
  }

  completeUpload(fileUploadId: string): Promise<NotionJsonObject> {
    return this.transport.requestJson(
      `/file_uploads/${encodeURIComponent(fileUploadId)}/complete`,
      { method: "POST" },
    );
  }
}
