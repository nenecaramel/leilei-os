import type { NotionJsonObject } from "./notion-transport.js";
import { NotionTransport } from "./notion-transport.js";

function request(
  transport: NotionTransport,
  path: string,
  method: "POST" | "PATCH",
  body: NotionJsonObject,
): Promise<NotionJsonObject> {
  return transport.requestJson(path, {
    method,
    body: JSON.stringify(body),
  });
}

export class NotionStructureClient {
  constructor(private readonly transport: NotionTransport) {}

  createDatabase(body: NotionJsonObject): Promise<NotionJsonObject> {
    return request(this.transport, "/databases", "POST", body);
  }

  updateDatabase(databaseId: string, body: NotionJsonObject): Promise<NotionJsonObject> {
    return request(
      this.transport,
      `/databases/${encodeURIComponent(databaseId)}`,
      "PATCH",
      body,
    );
  }

  createDataSource(body: NotionJsonObject): Promise<NotionJsonObject> {
    return request(this.transport, "/data_sources", "POST", body);
  }

  updateDataSource(dataSourceId: string, body: NotionJsonObject): Promise<NotionJsonObject> {
    return request(
      this.transport,
      `/data_sources/${encodeURIComponent(dataSourceId)}`,
      "PATCH",
      body,
    );
  }

  createView(body: NotionJsonObject): Promise<NotionJsonObject> {
    return request(this.transport, "/views", "POST", body);
  }

  updateView(viewId: string, body: NotionJsonObject): Promise<NotionJsonObject> {
    return request(
      this.transport,
      `/views/${encodeURIComponent(viewId)}`,
      "PATCH",
      body,
    );
  }

  deleteView(viewId: string): Promise<NotionJsonObject> {
    return this.transport.requestJson(`/views/${encodeURIComponent(viewId)}`, {
      method: "DELETE",
    });
  }
}
