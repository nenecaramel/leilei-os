import { NotionCommentClient } from "./notion-comment-client.js";
import { NotionPageBlockClient } from "./notion-page-block-client.js";
import {
  NotionApiError,
  NotionTransport,
  type NotionJsonObject,
} from "./notion-transport.js";

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

function requestedPropertyKeys(body: NotionJsonObject): string[] {
  const properties = asObject(body.properties);
  return properties ? Object.keys(properties) : [];
}

function verifyRequestedPropertyKeys(body: NotionJsonObject, readback: NotionJsonObject): void {
  const requested = requestedPropertyKeys(body);
  if (requested.length === 0) return;
  const properties = asObject(readback.properties);
  if (!properties || requested.some((key) => !(key in properties))) {
    throw new NotionExplicitWriteError(
      "VERIFICATION_FAILED",
      "Notion page readback did not contain the requested properties.",
    );
  }
}

function assertNonDestructivePageUpdate(body: NotionJsonObject): void {
  for (const key of ["in_trash", "archived", "erase_content"]) {
    if (key in body) {
      throw new NotionExplicitWriteError(
        "INVALID_WRITE",
        `Page update field ${key} is outside the Phase 8.6.2 write surface.`,
      );
    }
  }
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
    if (pageId) return this.readPage(pageId);

    const dataSourceId = parent ? asString(parent.data_source_id) : undefined;
    if (dataSourceId) {
      return this.transport.requestJson(`/data_sources/${encodeURIComponent(dataSourceId)}`);
    }

    const databaseId = parent ? asString(parent.database_id) : undefined;
    if (databaseId) {
      return this.transport.requestJson(`/databases/${encodeURIComponent(databaseId)}`);
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
    assertNonDestructivePageUpdate(body);
    await this.readCreateTarget(body);

    let written: NotionJsonObject;
    try {
      written = await this.pageClient.createPage(body);
    } catch (error) {
      return this.uncertainAfter(error, () => this.readCreateTarget(body));
    }

    const pageId = requireMatchingId(written, undefined, "page");
    const readback = await this.readPage(pageId);
    requireMatchingId(readback, pageId, "page");
    verifyRequestedPropertyKeys(body, readback);

    return {
      operation: "page.create",
      target_id: pageId,
      verified: true,
      provider_object: written.object ?? "page",
    };
  }

  async updatePage(pageId: string, body: NotionJsonObject): Promise<NotionExplicitWriteResult> {
    assertNonDestructivePageUpdate(body);
    await this.readPage(pageId);

    let written: NotionJsonObject;
    try {
      written = await this.pageClient.updatePage(pageId, body);
    } catch (error) {
      return this.uncertainAfter(error, () => this.readPage(pageId));
    }

    requireMatchingId(written, pageId, "page");
    const readback = await this.readPage(pageId);
    requireMatchingId(readback, pageId, "page");
    verifyRequestedPropertyKeys(body, readback);

    return {
      operation: "page.update",
      target_id: pageId,
      verified: true,
      provider_object: written.object ?? "page",
    };
  }

  async updatePageContent(pageId: string, body: NotionJsonObject): Promise<NotionExplicitWriteResult> {
    const before = await this.readPageMarkdown(pageId);
    assertCompleteMarkdown(before, pageId);

    let written: NotionJsonObject;
    try {
      written = await this.pageClient.updatePageMarkdown(pageId, body);
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
