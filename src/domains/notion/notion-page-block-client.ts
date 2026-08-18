import type { NotionJsonObject } from "./notion-transport.js";
import { NotionTransport } from "./notion-transport.js";

function jsonBody(body: NotionJsonObject): RequestInit {
  return { body: JSON.stringify(body) };
}

export class NotionPageBlockClient {
  constructor(private readonly transport: NotionTransport) {}

  createPage(body: NotionJsonObject): Promise<NotionJsonObject> {
    return this.transport.requestJson("/pages", {
      method: "POST",
      ...jsonBody(body),
    });
  }

  updatePage(pageId: string, body: NotionJsonObject): Promise<NotionJsonObject> {
    return this.transport.requestJson(`/pages/${encodeURIComponent(pageId)}`, {
      method: "PATCH",
      ...jsonBody(body),
    });
  }

  movePage(pageId: string, parent: NotionJsonObject): Promise<NotionJsonObject> {
    return this.transport.requestJson(`/pages/${encodeURIComponent(pageId)}/move`, {
      method: "POST",
      ...jsonBody({ parent }),
    });
  }

  updatePageMarkdown(pageId: string, body: NotionJsonObject): Promise<NotionJsonObject> {
    return this.transport.requestJson(`/pages/${encodeURIComponent(pageId)}/markdown`, {
      method: "PATCH",
      ...jsonBody(body),
    });
  }

  appendBlockChildren(blockId: string, body: NotionJsonObject): Promise<NotionJsonObject> {
    return this.transport.requestJson(`/blocks/${encodeURIComponent(blockId)}/children`, {
      method: "PATCH",
      ...jsonBody(body),
    });
  }

  updateBlock(blockId: string, body: NotionJsonObject): Promise<NotionJsonObject> {
    return this.transport.requestJson(`/blocks/${encodeURIComponent(blockId)}`, {
      method: "PATCH",
      ...jsonBody(body),
    });
  }

  deleteBlock(blockId: string): Promise<NotionJsonObject> {
    return this.transport.requestJson(`/blocks/${encodeURIComponent(blockId)}`, {
      method: "DELETE",
    });
  }
}
