import {
  NotionApiError,
  NotionTransport,
} from "./notion-transport.js";

const MAX_DEPTH = 8;
const MAX_BLOCKS = 500;
const MAX_TEXT_LENGTH = 60_000;

export type NotionReadErrorCode =
  | "NOT_CONFIGURED"
  | "AUTHENTICATION_FAILED"
  | "ACCESS_DENIED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "MALFORMED_RESPONSE"
  | "UPSTREAM";

export class NotionReadError extends Error {
  constructor(
    public readonly code: NotionReadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NotionReadError";
  }
}

export type NotionSearchInput = {
  query: string;
  limit?: number;
  cursor?: string;
};

export type NotionSearchPage = {
  id: string;
  title: string;
  url: string;
  last_edited_time: string;
};

export type NotionSearchResult = {
  results: NotionSearchPage[];
  metadata: {
    count: number;
    has_more: boolean;
    next_cursor: string | null;
  };
};

export type NotionPageReadResult = {
  page: NotionSearchPage;
  content: string;
  block_count: number;
  truncated: boolean;
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatUuid(compact: string): string {
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function normalizeNotionUuid(value: unknown): string | null {
  const compact = asString(value).replaceAll("-", "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(compact) ? formatUuid(compact) : null;
}

function malformed(message: string): NotionReadError {
  return new NotionReadError("MALFORMED_RESPONSE", message);
}

function richTextPlain(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => asString(asObject(item)?.plain_text))
    .join("");
}

function extractPageTitle(page: JsonObject): string {
  const properties = asObject(page.properties);
  if (!properties) return "Untitled";

  for (const property of Object.values(properties)) {
    const candidate = asObject(property);
    if (candidate?.type !== "title") continue;
    const title = richTextPlain(candidate.title).trim();
    if (title) return title;
  }

  return "Untitled";
}

function normalizePage(page: JsonObject): NotionSearchPage {
  return {
    id: asString(page.id),
    title: extractPageTitle(page),
    url: asString(page.url),
    last_edited_time: asString(page.last_edited_time),
  };
}

function renderBlock(block: JsonObject, depth: number): string {
  const type = asString(block.type);
  const payload = asObject(block[type]);
  const text = richTextPlain(payload?.rich_text);
  const indent = "  ".repeat(depth);

  switch (type) {
    case "heading_1":
      return `${indent}# ${text}`;
    case "heading_2":
      return `${indent}## ${text}`;
    case "heading_3":
      return `${indent}### ${text}`;
    case "heading_4":
      return `${indent}#### ${text}`;
    case "bulleted_list_item":
      return `${indent}- ${text}`;
    case "numbered_list_item":
      return `${indent}1. ${text}`;
    case "to_do":
      return `${indent}- [${payload?.checked === true ? "x" : " "}] ${text}`;
    case "quote":
      return `${indent}> ${text}`;
    case "callout":
      return `${indent}${text}`;
    case "toggle":
      return `${indent}${text}`;
    case "code": {
      const language = asString(payload?.language);
      return `${indent}\`\`\`${language}\n${text}\n${indent}\`\`\``;
    }
    case "divider":
      return `${indent}---`;
    case "equation":
      return `${indent}${asString(payload?.expression)}`;
    case "child_page":
      return `${indent}Child page: ${asString(payload?.title)}`;
    case "child_database":
      return `${indent}Child database: ${asString(payload?.title)}`;
    case "bookmark":
    case "embed":
    case "link_preview": {
      const url = asString(payload?.url);
      return text ? `${indent}${text} ${url}`.trimEnd() : `${indent}${url}`;
    }
    case "table_row": {
      const rawCells = payload?.cells;
      const cells: unknown[] = Array.isArray(rawCells) ? rawCells : [];
      const rendered = cells.map((cell: unknown) => richTextPlain(cell));
      return `${indent}| ${rendered.join(" | ")} |`;
    }
    default:
      return text ? `${indent}${text}` : "";
  }
}

function mapTransportError(error: unknown): NotionReadError {
  if (!(error instanceof NotionApiError)) {
    return new NotionReadError("UPSTREAM", "Notion is temporarily unavailable.");
  }

  switch (error.code) {
    case "NOT_CONFIGURED":
      return new NotionReadError("NOT_CONFIGURED", "Notion access is not configured.");
    case "AUTHENTICATION_FAILED":
      return new NotionReadError("AUTHENTICATION_FAILED", "Notion authentication failed.");
    case "ACCESS_DENIED":
      return new NotionReadError("ACCESS_DENIED", "Notion access was denied.");
    case "NOT_FOUND":
      return new NotionReadError("NOT_FOUND", "The Notion page was not found or is inaccessible.");
    case "RATE_LIMITED":
      return new NotionReadError("RATE_LIMITED", "Notion is temporarily rate limited.");
    case "CONFLICT":
    case "VALIDATION":
    case "UPSTREAM":
      return new NotionReadError("UPSTREAM", "Notion is temporarily unavailable.");
  }
}

export class NotionReadClient {
  private readonly transport: NotionTransport;

  constructor(
    token: string | undefined,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.transport = new NotionTransport(token, fetchImpl);
  }

  async searchPages(input: NotionSearchInput): Promise<NotionSearchResult> {
    const body: Record<string, unknown> = {
      query: input.query.normalize("NFC").trim(),
      page_size: input.limit ?? 10,
      filter: { property: "object", value: "page" },
    };
    if (input.cursor) body.start_cursor = input.cursor;

    const payload = await this.request("/search", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const results = Array.isArray(payload.results)
      ? payload.results
          .map((item) => asObject(item))
          .filter((item): item is JsonObject => item?.object === "page")
          .map(normalizePage)
      : [];

    return {
      results,
      metadata: {
        count: results.length,
        has_more: payload.has_more === true,
        next_cursor: typeof payload.next_cursor === "string"
          ? payload.next_cursor
          : null,
      },
    };
  }

  async readPage(pageId: string): Promise<NotionPageReadResult> {
    const pagePayload = await this.request(`/pages/${encodeURIComponent(pageId)}`);
    const expectedPageId = normalizeNotionUuid(pageId);
    const returnedPageId = normalizeNotionUuid(pagePayload.id);
    if (pagePayload.object !== "page" || !expectedPageId || !returnedPageId || returnedPageId !== expectedPageId) {
      throw malformed("Notion returned an invalid or unexpected page.");
    }
    const page = normalizePage({ ...pagePayload, id: returnedPageId });
    const lines: string[] = [];
    let blockCount = 0;
    let traversalTruncated = false;

    const readChildren = async (blockId: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH) {
        traversalTruncated = true;
        return;
      }

      let cursor: string | undefined;
      do {
        if (blockCount >= MAX_BLOCKS) {
          traversalTruncated = true;
          return;
        }

        const suffix = cursor
          ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}`
          : "?page_size=100";
        const payload = await this.request(
          `/blocks/${encodeURIComponent(blockId)}/children${suffix}`,
        );
        if (
          payload.object !== "list"
          || payload.type !== "block"
          || !asObject(payload.block)
          || !Array.isArray(payload.results)
          || typeof payload.has_more !== "boolean"
          || !(payload.next_cursor === null || typeof payload.next_cursor === "string")
        ) {
          throw malformed("Notion returned an invalid block list envelope.");
        }
        const nextCursor = payload.next_cursor;
        if (payload.has_more && (!nextCursor || nextCursor.trim() === "")) {
          throw malformed("Notion returned more blocks without a cursor.");
        }
        if (!payload.has_more && nextCursor !== null) {
          throw malformed("Notion returned a cursor without more blocks.");
        }
        if (payload.has_more && nextCursor === cursor) {
          throw malformed("Notion returned a non-advancing block cursor.");
        }
        const blocks = payload.results.map((rawBlock) => {
          const block = asObject(rawBlock);
          if (!block || asString(block.object) !== "block" || !normalizeNotionUuid(block.id)) {
            throw malformed("Notion returned an invalid block.");
          }
          return block;
        });

        for (const rawBlock of blocks) {
          if (blockCount >= MAX_BLOCKS) {
            traversalTruncated = true;
            return;
          }

          const block = asObject(rawBlock);
          if (!block) continue;
          blockCount += 1;

          const rendered = renderBlock(block, depth);
          if (rendered) lines.push(rendered);

          const type = asString(block.type);
          const shouldExpand = block.has_children === true &&
            type !== "child_page" &&
            type !== "child_database";
          if (shouldExpand) {
            const childId = asString(block.id);
            if (childId) await readChildren(childId, depth + 1);
          }
        }

        cursor = payload.has_more
          ? nextCursor!
          : undefined;
      } while (cursor);
    };

    await readChildren(pageId, 0);

    const fullContent = lines.join("\n");
    const textTruncated = fullContent.length > MAX_TEXT_LENGTH;
    const content = textTruncated
      ? fullContent.slice(0, MAX_TEXT_LENGTH)
      : fullContent;

    return {
      page,
      content,
      block_count: blockCount,
      truncated: traversalTruncated || textTruncated,
    };
  }

  private async request(path: string, init: RequestInit = {}): Promise<JsonObject> {
    try {
      return await this.transport.requestJson(path, init);
    } catch (error) {
      throw mapTransportError(error);
    }
  }
}
