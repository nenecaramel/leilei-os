import {
  NotionApiError,
  NotionTransport,
  type NotionJsonObject,
} from "./notion-transport.js";
import {
  NotionReadClient,
  NotionReadError,
  type NotionPageReadResult,
} from "./notion-read-client.js";

export type NotionIntegrationErrorCode =
  | "NOT_CONFIGURED"
  | "AUTHENTICATION_FAILED"
  | "ACCESS_DENIED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "INVALID_INPUT"
  | "MALFORMED_RESPONSE"
  | "UPSTREAM";

export class NotionIntegrationError extends Error {
  constructor(
    public readonly code: NotionIntegrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NotionIntegrationError";
  }
}

export type NotionConnectionResult = {
  provider: "notion";
  connection: {
    id: string;
    name: string;
    type: "bot" | "person" | "unknown";
  };
  workspace: {
    id: string | null;
    name: string | null;
  };
  capabilities: Array<{
    operation: "page.read" | "database.read" | "data_source.read" | "data_source.query";
    status: "unverified";
  }>;
};

export type NotionSchemaProperty = {
  id: string | null;
  name: string;
  type: string;
};

export type NotionDatabaseResult = {
  id: string;
  url: string | null;
  title: string;
  created_time: string | null;
  last_edited_time: string | null;
  data_sources: Array<{ id: string; name: string }>;
  schema: NotionSchemaProperty[];
};

export type NotionDataSourceResult = {
  id: string;
  url: string | null;
  title: string;
  created_time: string | null;
  last_edited_time: string | null;
  parent_database_id: string | null;
  schema: NotionSchemaProperty[];
};

export type NotionQueryFilter = Record<string, unknown>;
export type NotionQuerySort = Record<string, unknown>;

export type NotionDataSourceQueryInput = {
  dataSourceId: string;
  limit?: number;
  cursor?: string;
  filter?: NotionQueryFilter;
  sorts?: NotionQuerySort[];
};

export type NotionDataSourcePage = {
  id: string;
  url: string | null;
  title: string;
  created_time: string | null;
  last_edited_time: string | null;
  properties: Record<string, {
    id: string | null;
    type: string;
    value: unknown;
  }>;
};

export type NotionDataSourceQueryResult = {
  data_source_id: string;
  results: NotionDataSourcePage[];
  metadata: {
    count: number;
    has_more: boolean;
    next_cursor: string | null;
  };
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function richTextPlain(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => asString(asObject(item)?.plain_text))
    .join("");
}

function titleText(value: unknown): string {
  return richTextPlain(value) || (asString(asObject(value)?.content) || "Untitled");
}

function normalizeError(error: unknown): NotionIntegrationError {
  if (error instanceof NotionIntegrationError) return error;
  if (error instanceof NotionApiError) {
    switch (error.code) {
      case "NOT_CONFIGURED": return new NotionIntegrationError("NOT_CONFIGURED", "Notion access is not configured.");
      case "AUTHENTICATION_FAILED": return new NotionIntegrationError("AUTHENTICATION_FAILED", "Notion authentication failed.");
      case "ACCESS_DENIED": return new NotionIntegrationError("ACCESS_DENIED", "Notion access was denied.");
      case "NOT_FOUND": return new NotionIntegrationError("NOT_FOUND", "The Notion resource was not found or is inaccessible.");
      case "RATE_LIMITED": return new NotionIntegrationError("RATE_LIMITED", "Notion is temporarily rate limited.");
      case "VALIDATION": return new NotionIntegrationError("INVALID_INPUT", "Notion rejected the read request.");
      case "CONFLICT":
      case "UPSTREAM": return new NotionIntegrationError("UPSTREAM", "Notion is temporarily unavailable.");
    }
  }
  if (error instanceof NotionReadError) {
    switch (error.code) {
      case "NOT_CONFIGURED": return new NotionIntegrationError("NOT_CONFIGURED", "Notion access is not configured.");
      case "AUTHENTICATION_FAILED": return new NotionIntegrationError("AUTHENTICATION_FAILED", "Notion authentication failed.");
      case "ACCESS_DENIED": return new NotionIntegrationError("ACCESS_DENIED", "Notion access was denied.");
      case "NOT_FOUND": return new NotionIntegrationError("NOT_FOUND", "The Notion resource was not found or is inaccessible.");
      case "RATE_LIMITED": return new NotionIntegrationError("RATE_LIMITED", "Notion is temporarily rate limited.");
      case "UPSTREAM": return new NotionIntegrationError("UPSTREAM", "Notion is temporarily unavailable.");
    }
  }
  return new NotionIntegrationError("UPSTREAM", "Notion is temporarily unavailable.");
}

function invalid(message: string): NotionIntegrationError {
  return new NotionIntegrationError("INVALID_INPUT", message);
}

function malformed(message: string): NotionIntegrationError {
  return new NotionIntegrationError("MALFORMED_RESPONSE", message);
}

function assertNotionId(value: string, label: string): string {
  const normalized = value.trim();
  const compact = normalized.replaceAll("-", "");
  if (!/^[0-9a-fA-F]{32}$/.test(compact)) {
    throw invalid(`${label} must be a Notion UUID.`);
  }
  return formatCompactUuid(compact.toLowerCase());
}

function normalizeProviderId(value: unknown, label: string): string {
  try {
    return assertNotionId(asString(value), label);
  } catch {
    throw malformed(`Notion returned an invalid ${label}.`);
  }
}

function formatCompactUuid(value: string): string {
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function parseNotionPageReference(value: string): string {
  const normalized = value.trim();
  try {
    return assertNotionId(normalized, "page reference");
  } catch {
    // Continue with the safe Notion URL form below.
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw invalid("page reference must be a Notion page UUID or URL.");
  }
  const officialHost = url.hostname === "notion.so"
    || url.hostname === "www.notion.so"
    || url.hostname === "app.notion.com"
    || url.hostname === "notion.site"
    || url.hostname.endsWith(".notion.site");
  if (url.protocol !== "https:" || !officialHost) {
    throw invalid("page URL must use the official Notion host.");
  }

  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    throw invalid("page URL contains malformed encoding.");
  }
  const match = path.match(/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (!match) throw invalid("page URL must contain a Notion page UUID.");
  const compact = match[1]!.replaceAll("-", "");
  return formatCompactUuid(compact.toLowerCase());
}

function normalizeSchema(properties: unknown): NotionSchemaProperty[] {
  const object = asObject(properties);
  if (!object) throw malformed("Notion returned an invalid schema.");
  return Object.entries(object).map(([name, raw]) => {
    const property = asObject(raw);
    const type = asString(property?.type);
    if (!type) throw malformed("Notion returned a schema property without a type.");
    return {
      id: nullableString(property?.id),
      name,
      type,
    };
  });
}

function normalizePropertyValue(raw: unknown): NotionDataSourcePage["properties"][string] {
  const property = asObject(raw);
  const type = asString(property?.type);
  if (!property || !type) throw malformed("Notion returned an invalid page property.");
  const value = property[type];
  if (type === "title" || type === "rich_text") return { id: nullableString(property.id), type, value: richTextPlain(value) };
  if (type === "select" || type === "status") return { id: nullableString(property.id), type, value: asString(asObject(value)?.name) || null };
  if (type === "multi_select") {
    return { id: nullableString(property.id), type, value: Array.isArray(value) ? value.map((item) => asString(asObject(item)?.name)).filter(Boolean) : [] };
  }
  if (type === "people" || type === "relation") {
    return { id: nullableString(property.id), type, value: Array.isArray(value) ? value.map((item) => nullableString(asObject(item)?.id)).filter((item): item is string => item !== null) : [] };
  }
  if (type === "date") {
    const date = asObject(value);
    return { id: nullableString(property.id), type, value: date ? { start: nullableString(date.start), end: nullableString(date.end) } : null };
  }
  if (["number", "checkbox", "url", "email", "phone_number"].includes(type)) {
    return { id: nullableString(property.id), type, value: value ?? null };
  }
  return {
    id: nullableString(property.id),
    type,
    value: { unsupported: true, provider_type: type },
  };
}

function normalizePageResult(raw: unknown): NotionDataSourcePage {
  const page = asObject(raw);
  if (!page || asString(page.id) === "" || asString(page.object) !== "page") throw malformed("Notion returned an invalid data source page.");
  const properties = asObject(page.properties);
  if (!properties) throw malformed("Notion returned a page without properties.");
  let title = "Untitled";
  for (const property of Object.values(properties)) {
    const candidate = asObject(property);
    if (candidate?.type === "title") {
      title = richTextPlain(candidate.title) || "Untitled";
      break;
    }
  }
  return {
    id: normalizeProviderId(page.id, "page ID"),
    url: nullableString(page.url),
    title,
    created_time: nullableString(page.created_time),
    last_edited_time: nullableString(page.last_edited_time),
    properties: Object.fromEntries(Object.entries(properties).map(([name, value]) => [name, normalizePropertyValue(value)])),
  };
}

function validateJsonTree(value: unknown, depth = 0): void {
  if (depth > 8) throw invalid("query parameters are too deeply nested.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalid("query parameters must contain finite numbers.");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw invalid("query arrays are too large.");
    value.forEach((item) => validateJsonTree(item, depth + 1));
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key.length > 200) throw invalid("query parameter keys are too long.");
      validateJsonTree(item, depth + 1);
    }
    return;
  }
  throw invalid("query parameters must be JSON values.");
}

export class NotionIntegration {
  private readonly transport: NotionTransport;
  private readonly readClient: NotionReadClient;

  constructor(token: string | undefined, fetchImpl: typeof fetch = fetch) {
    this.transport = new NotionTransport(token, fetchImpl);
    this.readClient = new NotionReadClient(token, fetchImpl);
  }

  async getConnection(): Promise<NotionConnectionResult> {
    try {
      const payload = await this.transport.requestJson("/users/me");
      if (asString(payload.object) !== "user") throw malformed("Notion returned an invalid identity object.");
      const id = asString(payload.id);
      if (!id) throw malformed("Notion returned an identity without an ID.");
      const bot = asObject(payload.bot);
      const workspace = asObject(bot?.workspace) ?? asObject(payload.workspace);
      const owner = asObject(bot?.owner);
      const ownerWorkspace = asObject(owner?.workspace);
      const workspaceId = nullableString(bot?.workspace_id) ?? nullableString(payload.workspace_id) ?? nullableString(workspace?.id) ?? nullableString(ownerWorkspace?.id);
      const workspaceName = nullableString(bot?.workspace_name) ?? nullableString(payload.workspace_name) ?? nullableString(workspace?.name) ?? nullableString(ownerWorkspace?.name);
      const typeValue = asString(payload.type);
      return {
        provider: "notion",
        connection: {
          id,
          name: asString(payload.name) || "Notion connection",
          type: typeValue === "bot" || typeValue === "person" ? typeValue : "unknown",
        },
        workspace: { id: workspaceId, name: workspaceName },
        capabilities: [
          { operation: "page.read", status: "unverified" },
          { operation: "database.read", status: "unverified" },
          { operation: "data_source.read", status: "unverified" },
          { operation: "data_source.query", status: "unverified" },
        ],
      };
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async readPage(reference: string): Promise<NotionPageReadResult> {
    const pageId = parseNotionPageReference(reference);
    try {
      return await this.readClient.readPage(pageId);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async readDatabase(databaseId: string): Promise<NotionDatabaseResult> {
    const id = assertNotionId(databaseId, "database_id");
    try {
      const payload = await this.transport.requestJson(`/databases/${encodeURIComponent(id)}`);
      if (asString(payload.object) !== "database" || normalizeProviderId(payload.id, "database ID") !== id) throw malformed("Notion returned a database with an unexpected identity.");
      const dataSourcesRaw = Array.isArray(payload.data_sources) ? payload.data_sources : [];
      const dataSources = dataSourcesRaw.map((item) => {
        const source = asObject(item);
        if (!source || !asString(source.id)) throw malformed("Notion returned an invalid data source reference.");
        return { id: normalizeProviderId(source.id, "data source ID"), name: asString(source.name) || "Untitled" };
      });
      return {
        id,
        url: nullableString(payload.url),
        title: titleText(payload.title),
        created_time: nullableString(payload.created_time),
        last_edited_time: nullableString(payload.last_edited_time),
        data_sources: dataSources,
        schema: payload.properties === undefined ? [] : normalizeSchema(payload.properties),
      };
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async readDataSource(dataSourceId: string): Promise<NotionDataSourceResult> {
    const id = assertNotionId(dataSourceId, "data_source_id");
    try {
      const payload = await this.transport.requestJson(`/data_sources/${encodeURIComponent(id)}`);
      if (asString(payload.object) !== "data_source" || normalizeProviderId(payload.id, "data source ID") !== id) throw malformed("Notion returned an invalid data source.");
      const parent = asObject(payload.parent);
      const parentDatabaseId = parent?.database_id === undefined || parent?.database_id === null
        ? null
        : normalizeProviderId(parent.database_id, "parent database ID");
      return {
        id,
        url: nullableString(payload.url),
        title: titleText(payload.title),
        created_time: nullableString(payload.created_time),
        last_edited_time: nullableString(payload.last_edited_time),
        parent_database_id: parentDatabaseId,
        schema: normalizeSchema(payload.properties),
      };
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async queryDataSource(input: NotionDataSourceQueryInput): Promise<NotionDataSourceQueryResult> {
    const dataSourceId = assertNotionId(input.dataSourceId, "data_source_id");
    const limit = input.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid("limit must be an integer between 1 and 100.");
    if (input.cursor !== undefined && (typeof input.cursor !== "string" || input.cursor.trim() === "" || input.cursor.length > 2000)) throw invalid("cursor must be a non-empty string of at most 2000 characters.");
    if (input.filter !== undefined) {
      if (!asObject(input.filter)) throw invalid("filter must be a JSON object.");
      validateJsonTree(input.filter);
    }
    if (input.sorts !== undefined) {
      if (!Array.isArray(input.sorts) || input.sorts.length > 10) throw invalid("sorts must contain at most 10 items.");
      validateJsonTree(input.sorts);
    }
    const body: NotionJsonObject = { page_size: limit, result_type: "page" };
    if (input.cursor) body.start_cursor = input.cursor;
    if (input.filter) body.filter = input.filter;
    if (input.sorts) body.sorts = input.sorts;
    try {
      const payload = await this.transport.requestJson(`/data_sources/${encodeURIComponent(dataSourceId)}/query`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (
        payload.object !== "list"
        || payload.type !== "page_or_data_source"
        || !asObject(payload.page_or_data_source)
        || !Array.isArray(payload.results)
        || typeof payload.has_more !== "boolean"
        || !(payload.next_cursor === null || typeof payload.next_cursor === "string")
      ) {
        throw malformed("Notion returned an invalid data source query envelope.");
      }
      const rawResults = payload.results;
      const results = rawResults.map(normalizePageResult);
      const hasMore = payload.has_more;
      const nextCursor = payload.next_cursor;
      if (hasMore && (!nextCursor || nextCursor.trim() === "")) throw malformed("Notion returned more results without a cursor.");
      if (!hasMore && nextCursor !== null) throw malformed("Notion returned a cursor without more results.");
      return {
        data_source_id: dataSourceId,
        results,
        metadata: { count: results.length, has_more: hasMore, next_cursor: nextCursor },
      };
    } catch (error) {
      throw normalizeError(error);
    }
  }
}
