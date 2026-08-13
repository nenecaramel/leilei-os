import type { NotionJsonObject } from "./notion-transport.js";
import { NotionTransport } from "./notion-transport.js";

export class NotionCommentClient {
  constructor(private readonly transport: NotionTransport) {}

  createComment(body: NotionJsonObject): Promise<NotionJsonObject> {
    return this.transport.requestJson("/comments", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  updateComment(commentId: string, body: NotionJsonObject): Promise<NotionJsonObject> {
    return this.transport.requestJson(`/comments/${encodeURIComponent(commentId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }
}
