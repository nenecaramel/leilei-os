import { NotionCommentClient } from "./notion-comment-client.js";
import { NotionPageBlockClient } from "./notion-page-block-client.js";
import {
  NotionApiError,
  NotionTransport,
  type NotionJsonObject,
} from "./notion-transport.js";
import {
  notionPageContentUpdateBodySchema,
  notionPageCreateMutationBodySchema,
  notionPageUpdateBodySchema,
} from "./notion-explicit-write-schema.js";

export type NotionExplicitWriteErrorCode =
  | "INVALID_WRITE"
  | "UNCERTAIN_WRITE"
  | "VERIFICATION_FAILED";

export class NotionExplicitWriteError extends Error {
  constructor(
    public readonly code: NotionExplicitWriteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NotionExplicitWriteError";
  }
}

export type NotionExplicitWriteResult = NotionJsonObject & {
  operation: string;
  target_id: string;
  verified: true;
};

function asObject(value: unknown): NotionJsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as NotionJsonObject;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function canonicalId(value: string): string {
  return value.replaceAll("-", "").toLowerCase();
}

function requireMatchingId(
  payload: NotionJsonObject,
  expectedId: string | undefined,
  objectType: string,
): string {
  const id = asString(payload.id);
  if (!id) {
    throw new NotionExplicitWriteError(
      "VERIFICATION_FAILED",
      `Notion ${objectType} response did not include a stable ID.`,
    );
  }
  if (expectedId && canonicalId(id) !== canonicalId(expectedId)) {
    throw new NotionExplicitWriteError(
      "VERIFICATION_FAILED",
      `Notion ${objectType} readback returned a different stable ID.`,
    );
  }
  return id;
}

function isUncertainProviderError(error: unknown): boolean {
  return error instanceof NotionApiError && error.code === "UPSTREAM";
}

function comparableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparableValue);
  const object = asObject(value);
  if (!object) return value;

  const text = asObject(object.text);
  if (text && typeof text.content === "string") return { content: text.content };
  if (typeof object.plain_text === "string") return { content: object.plain_text };

  return Object.fromEntries(
    Object.entries(object)
      .filter(([key]) => !["id", "type", "object", "annotations", "color", "href", "link"].includes(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, comparableValue(nested)]),
  );
}

function verifyRequestedPropertyValues(body: NotionJsonObject, readback: NotionJsonObject): void {
  const requestedProperties = asObject(body.properties);
  if (!requestedProperties || Object.keys(requestedProperties).length === 0) return;
  const properties = asObject(readback.properties);
  if (!properties) {
    throw new NotionExplicitWriteError(
      "VERIFICATION_FAILED",
      "Notion page readback did not contain page properties.",
    );
  }

  for (const [key, requestedValue] of Object.entries(requestedProperties)) {
    if (!(key in properties)) {
      throw new NotionExplicitWriteError(
        "VERIFICATION_FAILED",
        "Notion page readback did not contain the requested properties.",
      );
    }
    if (JSON.stringify(comparableValue(properties[key])) !== JSON.stringify(comparableValue(requestedValue))) {
      throw new NotionExplicitWriteError(
        "VERIFICATION_FAILED",
        "Notion page readback did not contain the requested property values.",
      );
    }
  }
}

function parsePagePayload(
  schema: { safeParse(value: unknown): { success: true; data: unknown } | { success: false } },
  body: NotionJsonObject,
  operation: string,
): NotionJsonObject {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new NotionExplicitWriteError(
      "INVALID_WRITE",
      `Notion ${operation} payload contains fields outside the explicit write allowlist.`,
    );
  }
  return parsed.data as NotionJsonObject;
}

function richTextPlainText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts: string[] = [];
  for (const item of value) {
    const object = asObject(item);
    if (!object) return undefined;
    const plain = asString(object.plain_text);
    if (plain !== undefined) {
      parts.push(plain);
      continue;
    }
    const text = asObject(object.text);
    const content = text ? asString(text.content) : undefined;
    if (content !== undefined) {
      parts.push(content);
      continue;
    }
    return undefined;
  }
  return parts.join("");
}

function verifyCommentBody(body: NotionJsonObject, readback: NotionJsonObject): void {
  const requestedText = richTextPlainText(body.rich_text);
  if (requestedText === undefined) return;
  const readbackText = richTextPlainText(readback.rich_text);
  if (readbackText !== requestedText) {
    throw new NotionExplicitWriteError(
      "VERIFICATION_FAILED",
      "Notion comment readback did not match the requested comment text.",
    );
  }
}

function assertCompleteMarkdown(payload: NotionJsonObject, expectedId: string): string {
  requireMatchingId(payload, expectedId, "page markdown");
  if (payload.truncated === true) {
    throw new NotionExplicitWriteError(
      "VERIFICATION_FAILED",
      "Notion page markdown was truncated, so the write cannot be safely verified.",
    );
  }
  const unknownBlockIds = payload.unknown_block_ids;
  if (Array.isArray(unknownBlockIds) && unknownBlockIds.length > 0) {
    throw new NotionExplicitWriteError(
      "VERIFICATION_FAILED",
      "Notion page markdown contains unresolved blocks, so the write cannot be safely verified.",
    );
  }
  if (typeof payload.markdown !== "string") {
    throw new NotionExplicitWriteError(
      "VERIFICATION_FAILED",
      "Notion page markdown readback did not include markdown content.",
    );
  }
  return payload.markdown;
}

function requestedMarkdown(body: NotionJsonObject): { content: string; replace: boolean } | undefined {
  if (body.type === "replace_content") {
    const replaceContent = asObject(body.replace_content);
    const content = replaceContent ? asString(replaceContent.new_str) : undefined;
    if (content !== undefined) return { content, replace: true };
  }
  if (body.type === "insert_content") {
    const insertContent = asObject(body.insert_content);
    const content = insertContent ? asString(insertContent.content) : undefined;
    if (content !== undefined) return { content, replace: false };
  }
  return undefined;
}

function verifyRequestedMarkdown(requested: { content: string; replace: boolean }, markdown: string): void {
  const matches = requested.replace
    ? markdown === requested.content
    : markdown.includes(requested.content);
  if (!matches) {
    throw new NotionExplicitWriteError(
      "VERIFICATION_FAILED",
      "Notion page content readback did not contain the requested content.",
    );
  }
}

export class NotionExplicitWriteService {
  private readonly transport: NotionTransport;
  private readonly pageClient: NotionPageBlockClient;
  private readonly commentClient: NotionCommentClient;

  constructor(token: string | undefined, fetchImpl: typeof fetch = fetch) {
    this.transport = new NotionTransport(token, fetchImpl);
    this.pageClient = new NotionPageBlockClient(this.transport);
    this.commentClient = new NotionCommentClient(this.transport);
  }

  private readPage(pageId: string): Promise<NotionJsonObject> {
    return this.transport.requestJson(`/pages/${encodeURIComponent(pageId)}`);
  }

  private readPageMarkdown(pageId: string): Promise<NotionJsonObject> {
    return this.transport.requestJson(`/pages/${encodeURIComponent(pageId)}/markdown`);
  }

  private readComment(commentId: string): Promise<NotionJsonObject> {
    return this.transport.requestJson(`/comments/${encodeURIComponent(commentId)}`);
  }

  private async readCreateTarget(body: NotionJsonObject): Promise<NotionJsonObject> {
    const parent = asObject(body.parent);
    const pageId = parent ? asString(parent.page_id) : undefined;
    if (pageId) {
      const readback = await this.readPage(pageId);
      requireMatchingId(readback, pageId, "parent page");
      return readback;
    }

    const dataSourceId = parent ? asString(parent.data_source_id) : undefined;
    if (dataSourceId) {
      const readback = await this.transport.requestJson(`/data_sources/${encodeURIComponent(dataSourceId)}`);
      requireMatchingId(readback, dataSourceId, "parent data source");
      return readback;
    }

    const databaseId = parent ? asString(parent.database_id) : undefined;
    if (databaseId) {
      const readback = await this.transport.requestJson(`/databases/${encodeURIComponent(databaseId)}`);
      requireMatchingId(readback, databaseId, "parent database");
      return readback;
    }

    return this.transport.requestJson("/users/me");
  }

  private async uncertainAfter(error: unknown, readback: () => Promise<unknown>): Promise<never> {
    if (!isUncertainProviderError(error)) throw error;
    try {
      await readback();
    } catch {
      // The original write outcome remains uncertain. Never retry the mutation here.
    }
    throw new NotionExplicitWriteError(
      "UNCERTAIN_WRITE",
      "The Notion write outcome is uncertain. A fresh readback was attempted and the write was not retried.",
    );
  }

  async createPage(body: NotionJsonObject): Promise<NotionExplicitWriteResult> {
    const validatedBody = parsePagePayload(notionPageCreateMutationBodySchema, body, "page create");
    await this.readCreateTarget(validatedBody);

    let written: NotionJsonObject;
    try {
      written = await this.pageClient.createPage(validatedBody);
    } catch (error) {
      return this.uncertainAfter(error, () => this.readCreateTarget(validatedBody));
    }

    const pageId = requireMatchingId(written, undefined, "page");
    const readback = await this.readPage(pageId);
    requireMatchingId(readback, pageId, "page");
    verifyRequestedPropertyValues(validatedBody, readback);

    return {
      operation: "page.create",
      target_id: pageId,
      verified: true,
      provider_object: written.object ?? "page",
    };
  }

  async updatePage(pageId: string, body: NotionJsonObject): Promise<NotionExplicitWriteResult> {
    const validatedBody = parsePagePayload(notionPageUpdateBodySchema, body, "page update");
    await this.readPage(pageId);

    let written: NotionJsonObject;
    try {
      written = await this.pageClient.updatePage(pageId, validatedBody);
    } catch (error) {
      return this.uncertainAfter(error, () => this.readPage(pageId));
    }

    requireMatchingId(written, pageId, "page");
    const readback = await this.readPage(pageId);
    requireMatchingId(readback, pageId, "page");
    verifyRequestedPropertyValues(validatedBody, readback);

    return {
      operation: "page.update",
      target_id: pageId,
      verified: true,
      provider_object: written.object ?? "page",
    };
  }

  async updatePageContent(pageId: string, body: NotionJsonObject): Promise<NotionExplicitWriteResult> {
    const validatedBody = parsePagePayload(notionPageContentUpdateBodySchema, body, "page content update");
    const requested = requestedMarkdown(validatedBody);
    if (!requested) {
      throw new NotionExplicitWriteError(
        "INVALID_WRITE",
        "Notion page content update did not include verifiable content.",
      );
    }
    const before = await this.readPageMarkdown(pageId);
    assertCompleteMarkdown(before, pageId);

    let written: NotionJsonObject;
    try {
      written = await this.pageClient.updatePageMarkdown(pageId, validatedBody);
    } catch (error) {
      return this.uncertainAfter(error, () => this.readPageMarkdown(pageId));
    }

    const providerMarkdown = assertCompleteMarkdown(written, pageId);
    const readback = await this.readPageMarkdown(pageId);
    const readbackMarkdown = assertCompleteMarkdown(readback, pageId);
    if (readbackMarkdown !== providerMarkdown) {
      throw new NotionExplicitWriteError(
        "VERIFICATION_FAILED",
        "Notion page content changed again before the write could be verified.",
      );
    }
    verifyRequestedMarkdown(requested, readbackMarkdown);

    return {
      operation: "page.update_content",
      target_id: pageId,
      verified: true,
      provider_object: written.object ?? "page_markdown",
    };
  }

  async createComment(pageId: string, body: NotionJsonObject): Promise<NotionExplicitWriteResult> {
    await this.readPage(pageId);
    const requestBody: NotionJsonObject = {
      ...body,
      parent: { page_id: pageId },
    };

    let written: NotionJsonObject;
    try {
      written = await this.commentClient.createComment(requestBody);
    } catch (error) {
      return this.uncertainAfter(error, () => this.readPage(pageId));
    }

    const commentId = requireMatchingId(written, undefined, "comment");
    const readback = await this.readComment(commentId);
    requireMatchingId(readback, commentId, "comment");
    verifyCommentBody(body, readback);

    return {
      operation: "comment.create",
      target_id: commentId,
      verified: true,
      provider_object: written.object ?? "comment",
      discussion_id: readback.discussion_id ?? written.discussion_id ?? null,
    };
  }

  async replyComment(
    pageId: string,
    discussionId: string,
    body: NotionJsonObject,
  ): Promise<NotionExplicitWriteResult> {
    await this.readPage(pageId);
    const requestBody: NotionJsonObject = {
      ...body,
      discussion_id: discussionId,
    };

    let written: NotionJsonObject;
    try {
      written = await this.commentClient.createComment(requestBody);
    } catch (error) {
      return this.uncertainAfter(error, () => this.readPage(pageId));
    }

    const commentId = requireMatchingId(written, undefined, "comment");
    const readback = await this.readComment(commentId);
    requireMatchingId(readback, commentId, "comment");
    if (
      asString(readback.discussion_id) &&
      canonicalId(String(readback.discussion_id)) !== canonicalId(discussionId)
    ) {
      throw new NotionExplicitWriteError(
        "VERIFICATION_FAILED",
        "Notion comment readback belongs to a different discussion.",
      );
    }
    verifyCommentBody(body, readback);

    return {
      operation: "comment.reply",
      target_id: commentId,
      verified: true,
      provider_object: written.object ?? "comment",
      discussion_id: discussionId,
    };
  }
}
