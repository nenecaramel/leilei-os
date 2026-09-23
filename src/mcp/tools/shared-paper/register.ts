import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SharedPaperServiceError } from "../../../domains/shared-paper/shared-paper-service.js";
import type { SharedPaperEdit, SharedPaperRecord } from "../../../domains/shared-paper/shared-paper-types.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { formatMcpDetailPointer, joinMcpContentLines, quoteMcpText } from "../content-contract.js";
import { MCP_IDEMPOTENCY_KEY_MAX_LENGTH, MCP_IDEMPOTENCY_KEY_MIN_LENGTH, MCP_IDEMPOTENCY_KEY_PATTERN } from "../../../domains/mcp-write/mcp-write-idempotency.js";
import { createBodyMatchSnippet, createLeadingPreview } from "../../../domains/compact-text.js";
import { codePointLength } from "../../../shared/unicode.js";
import {
  decodeMcpPaginationCursor,
  McpPaginationCursorError,
  paginateMcpRows,
} from "../pagination.js";
import {
  boundedReadInputSchemaFields,
  boundedReadMetadataSchema,
  McpBoundedReadCursorError,
  sliceMcpBoundedContent,
} from "../bounded-read.js";

const idSchema = z.string().uuid();
const authorSchema = z.enum(["L", "G", "C"]);
const scopeSchema = z.enum(["active", "archived"]);
const editTargetSchema = z.enum(["content", "title"]);
const idempotencyKeySchema = z.string().min(MCP_IDEMPOTENCY_KEY_MIN_LENGTH).max(MCP_IDEMPOTENCY_KEY_MAX_LENGTH).regex(MCP_IDEMPOTENCY_KEY_PATTERN);
const EDIT_TEXT_PREVIEW_CODE_POINTS = 200;
const MAX_HISTORY_TEXT_EDITS = 5;
const paperSummarySchema = z.object({ id: idSchema, title: z.string(), preview: z.string(), snippet: z.string().nullable(), revision: z.number().int().min(1), created_by: authorSchema, updated_by: authorSchema, created_at: z.string().datetime(), updated_at: z.string().datetime(), archived_at: z.string().datetime().nullable(), detail_tool: z.literal("get_shared_paper"), detail_arguments: z.object({ id: idSchema }).strict() }).strict();
const paperDetailSchema = z.object({ id: idSchema, title: z.string(), content: z.string(), revision: z.number().int().min(1), created_by: authorSchema, updated_by: authorSchema, created_at: z.string().datetime(), updated_at: z.string().datetime(), archived_at: z.string().datetime().nullable() }).strict();
const editSchema = z.object({ id: idSchema, paper_id: idSchema, base_revision: z.number().int().min(1), revision: z.number().int().min(2), author: authorSchema, target: editTargetSchema, start_offset: z.number().int().nonnegative(), end_offset: z.number().int().nonnegative(), deleted_text: z.string(), inserted_text: z.string(), created_at: z.string().datetime() }).strict();
const listInput = z.object({ limit: z.number().int().min(1).max(100).default(50).optional(), cursor: z.string().min(1).max(2_048).optional(), scope: scopeSchema.default("active").optional() }).strict();
const searchInput = z.object({ query: boundedCodePointString(400, 200, 1), limit: z.number().int().min(1).max(100).default(50).optional(), cursor: z.string().min(1).max(2_048).optional(), scope: scopeSchema.default("active").optional() }).strict();
const getInput = z.object({ id: idSchema, ...boundedReadInputSchemaFields(z) }).strict();
const createInput = z.object({ title: boundedCodePointString(400, 200, 1), content: boundedCodePointString(200_000, 100_000), author: authorSchema, idempotency_key: idempotencyKeySchema }).strict();
const editInput = z.object({ id: idSchema, expected_revision: z.number().int().min(1), author: authorSchema, target: editTargetSchema.default("content").optional(), match_text: boundedCodePointString(200_000, 100_000), replacement_text: boundedCodePointString(200_000, 100_000), idempotency_key: idempotencyKeySchema }).strict();
const appendInput = z.object({ id: idSchema, expected_revision: z.number().int().min(1), author: authorSchema, text: boundedCodePointString(200_000, 100_000, 1), idempotency_key: idempotencyKeySchema }).strict();
const editsInput = z.object({ id: idSchema, limit: z.number().int().min(1).max(100).default(50).optional(), before_revision: z.number().int().min(1).optional() }).strict();
const lifecycleInput = z.object({ id: idSchema, idempotency_key: idempotencyKeySchema }).strict();
const listOutput = z.object({ success: z.boolean(), data: z.object({ papers: z.array(paperSummarySchema), count: z.number().int().nonnegative(), metadata: z.object({ returned: z.number().int().nonnegative(), has_more: z.boolean(), next_cursor: z.string().nullable() }).strict() }).optional(), error: mcpToolErrorDetailsSchema.optional() }).strict();
const searchOutput = listOutput;
const getOutput = z.object({ success: z.boolean(), data: z.object({ paper: paperDetailSchema, content_metadata: boundedReadMetadataSchema(z) }).optional(), error: mcpToolErrorDetailsSchema.optional() }).strict();
const mutationOutput = z.object({ success: z.boolean(), data: z.object({ paper_id: idSchema, revision: z.number().int().min(1), edit_id: idSchema.optional(), base_revision: z.number().int().min(1).optional(), author: authorSchema.optional(), created_at: z.string().datetime().optional(), metadata: z.object({ idempotent_replay: z.boolean() }).strict(), detail_tool: z.literal("get_shared_paper"), detail_arguments: z.object({ id: idSchema }).strict() }).optional(), error: mcpToolErrorDetailsSchema.optional() }).strict();
const editsOutput = z.object({ success: z.boolean(), data: z.object({ edits: z.array(editSchema), count: z.number().int().nonnegative() }).optional(), error: mcpToolErrorDetailsSchema.optional() }).strict();
const lifecycleOutput = z.object({ success: z.boolean(), data: z.object({ paper_id: idSchema, archived_at: z.string().datetime().nullable(), metadata: z.object({ idempotent_replay: z.boolean() }).strict(), detail_tool: z.literal("get_shared_paper"), detail_arguments: z.object({ id: idSchema }).strict() }).optional(), error: mcpToolErrorDetailsSchema.optional() }).strict();
const deleteOutput = z.object({ success: z.boolean(), data: z.object({ paper_id: idSchema, deleted: z.literal(true), metadata: z.object({ idempotent_replay: z.boolean() }).strict() }).optional(), error: mcpToolErrorDetailsSchema.optional() }).strict();

export interface SharedPaperToolService {
  listPapers(input: { userId: string; limit?: number; scope?: "active" | "archived"; offset?: number }): Promise<SharedPaperRecord[]>;
  searchPapers(input: { userId: string; query: unknown; limit?: number; scope?: "active" | "archived"; offset?: number }): Promise<SharedPaperRecord[]>;
  getPaper(input: { userId: string; paperId: string }): Promise<SharedPaperRecord>;
  listEdits(input: { userId: string; paperId: string; limit?: number; beforeRevision?: number }): Promise<SharedPaperEdit[]>;
  createPaperIdempotently(input: { userId: string; title: string; content: string; author: "L" | "G" | "C"; idempotencyKey: string }): Promise<{ paper: SharedPaperRecord; outcome: "committed" | "replayed" }>;
  editPaperByMatch(input: { userId: string; paperId: string; expectedRevision: number; author: "L" | "G" | "C"; target?: "content" | "title"; matchText: string; replacementText: string; idempotencyKey: string }): Promise<{ paper: SharedPaperRecord; edit: SharedPaperEdit; outcome?: "committed" | "replayed" }>;
  appendPaperIdempotently(input: { userId: string; paperId: string; expectedRevision: number; author: "L" | "G" | "C"; text: string; idempotencyKey: string }): Promise<{ paper: SharedPaperRecord; edit: SharedPaperEdit; outcome: "committed" | "replayed" }>;
  archivePaperIdempotently(input: { userId: string; paperId: string; idempotencyKey: string }): Promise<{ paper: SharedPaperRecord; outcome: "committed" | "replayed" }>;
  restorePaperIdempotently(input: { userId: string; paperId: string; idempotencyKey: string }): Promise<{ paper: SharedPaperRecord; outcome: "committed" | "replayed" }>;
  deletePaperIdempotently(input: { userId: string; paperId: string; idempotencyKey: string }): Promise<{ paperId: string; outcome: "committed" | "replayed" }>;
}

export type SharedPaperToolDependencies = { sharedPaperService: SharedPaperToolService; getAuthenticatedUserId: () => string };

export class SharedPaperAuthenticationError extends Error {
  constructor() { super("Authenticated MCP user context is unavailable."); this.name = "SharedPaperAuthenticationError"; }
}

export function registerSharedPaperTools(server: McpServer, dependencies: SharedPaperToolDependencies): void {
  server.registerTool("list_shared_papers", { title: "List shared papers", description: "List shared papers owned by the authenticated user. scope defaults to active; pass archived to browse the archive. Results are compact discovery records; use get_shared_paper for full content. When has_more is true, pass next_cursor back as cursor with the same scope.", inputSchema: listInput, outputSchema: listOutput, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ limit, cursor, scope }) => {
    const pageSize = limit ?? 50;
    const resolvedScope = scope ?? "active";
    return runRead(
      (offset, fetchLimit) => dependencies.sharedPaperService.listPapers({ userId: dependencies.getAuthenticatedUserId(), limit: fetchLimit, scope: resolvedScope, offset }),
      "list_shared_papers",
      pageSize,
      cursor,
      { scope: resolvedScope },
    );
  });
  server.registerTool("search_shared_papers", { title: "Search shared papers", description: "Search the authenticated user's shared paper titles and canonical content using normalized substring matching. scope defaults to active; pass archived to search the archive. Results are compact; use get_shared_paper for full content. When has_more is true, pass next_cursor back as cursor with the same query and scope.", inputSchema: searchInput, outputSchema: searchOutput, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ query, limit, cursor, scope }) => {
    const pageSize = limit ?? 50;
    const resolvedScope = scope ?? "active";
    return runRead(
      (offset, fetchLimit) => dependencies.sharedPaperService.searchPapers({ userId: dependencies.getAuthenticatedUserId(), query, limit: fetchLimit, scope: resolvedScope, offset }),
      "search_shared_papers",
      pageSize,
      cursor,
      { query, scope: resolvedScope },
      query,
    );
  });
  server.registerTool("get_shared_paper", { title: "Read a shared paper", description: "Read one shared paper by exact id using a bounded canonical content window. max_chars defaults to 12000 Unicode code points. When content_metadata.truncated is true, continue with content_metadata.next_cursor and the same id. A cursor becomes invalid when the paper revision changes.", inputSchema: getInput, outputSchema: getOutput, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ id, max_chars, cursor }) => runDetail(() => dependencies.sharedPaperService.getPaper({ userId: dependencies.getAuthenticatedUserId(), paperId: id }), max_chars, cursor));
  server.registerTool("create_shared_paper", { title: "Create a shared paper", description: "Create one shared paper with a single canonical content body. L, G, and C are provenance authors only; provide a stable idempotency_key for safe replay.", inputSchema: createInput, outputSchema: mutationOutput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ title, content, author, idempotency_key }) => runMutation(() => dependencies.sharedPaperService.createPaperIdempotently({ userId: dependencies.getAuthenticatedUserId(), title, content, author, idempotencyKey: idempotency_key }), dependencies));
  server.registerTool("edit_shared_paper", { title: "Edit a shared paper", description: "Apply one unique exact match replacement to the shared paper's canonical content or title. target defaults to content. Supply the expected revision and stable idempotency_key; stale revisions are rejected and no automatic merge occurs.", inputSchema: editInput, outputSchema: mutationOutput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ id, expected_revision, author, target, match_text, replacement_text, idempotency_key }) => runMutation(async () => { const result = await dependencies.sharedPaperService.editPaperByMatch({ userId: dependencies.getAuthenticatedUserId(), paperId: id, expectedRevision: expected_revision, author, target: target ?? "content", matchText: match_text, replacementText: replacement_text, idempotencyKey: idempotency_key }); return { ...result, edit: result.edit }; }, dependencies));
  server.registerTool("append_shared_paper", { title: "Append to a shared paper", description: "Append text directly to the end of canonical content without reading or resending the existing body. Supply expected_revision and a stable idempotency_key; stale revisions are rejected and replay never appends twice.", inputSchema: appendInput, outputSchema: mutationOutput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ id, expected_revision, author, text, idempotency_key }) => runMutation(() => dependencies.sharedPaperService.appendPaperIdempotently({ userId: dependencies.getAuthenticatedUserId(), paperId: id, expectedRevision: expected_revision, author, text, idempotencyKey: idempotency_key }), dependencies));
  server.registerTool("list_shared_paper_edits", { title: "List shared paper edits", description: "List committed save-level deltas for one shared paper. Use before_revision to continue with older revisions.", inputSchema: editsInput, outputSchema: editsOutput, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ id, limit, before_revision }) => runEdits(() => dependencies.sharedPaperService.listEdits({ userId: dependencies.getAuthenticatedUserId(), paperId: id, limit, beforeRevision: before_revision }), dependencies));
  server.registerTool("archive_shared_paper", { title: "Archive a shared paper", description: "Archive one shared paper without changing canonical content or revision. Provide a stable idempotency_key for safe replay.", inputSchema: lifecycleInput, outputSchema: lifecycleOutput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ id, idempotency_key }) => runLifecycleMutation(() => dependencies.sharedPaperService.archivePaperIdempotently({ userId: dependencies.getAuthenticatedUserId(), paperId: id, idempotencyKey: idempotency_key })));
  server.registerTool("restore_shared_paper", { title: "Restore a shared paper", description: "Restore one archived shared paper to the active list without changing canonical content or revision. Provide a stable idempotency_key for safe replay.", inputSchema: lifecycleInput, outputSchema: lifecycleOutput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ id, idempotency_key }) => runLifecycleMutation(() => dependencies.sharedPaperService.restorePaperIdempotently({ userId: dependencies.getAuthenticatedUserId(), paperId: id, idempotencyKey: idempotency_key })));
  server.registerTool("delete_shared_paper", { title: "Permanently delete a shared paper", description: "Permanently delete an archived shared paper and its edit journal. The paper must already be archived. Provide a stable idempotency_key for safe replay.", inputSchema: lifecycleInput, outputSchema: deleteOutput, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } }, async ({ id, idempotency_key }) => runDeleteMutation(() => dependencies.sharedPaperService.deletePaperIdempotently({ userId: dependencies.getAuthenticatedUserId(), paperId: id, idempotencyKey: idempotency_key })));
}

async function runRead(
  read: (offset: number, fetchLimit: number) => Promise<SharedPaperRecord[]>,
  tool: "list_shared_papers" | "search_shared_papers",
  pageSize: number,
  cursor: string | undefined,
  cursorContext: unknown,
  query?: string,
) {
  try {
    const offset = decodeMcpPaginationCursor(cursor, tool, cursorContext);
    const papers = await read(offset, pageSize + 1);
    const page = paginateMcpRows({
      rows: papers,
      pageSize,
      offset,
      tool,
      context: cursorContext,
    });
    const summaries = page.items.map((paper) => toSummary(paper, query));
    return {
      content: [{ type: "text" as const, text: sharedPaperContent(summaries) }],
      structuredContent: {
        success: true as const,
        data: {
          papers: summaries,
          count: summaries.length,
          metadata: page.metadata,
        },
      },
    };
  } catch (error) {
    if (error instanceof McpPaginationCursorError) {
      return createMcpToolError("INVALID_CURSOR", "The Shared Paper continuation cursor is invalid for this request.");
    }
    return sharedError(error, tool);
  }
}
async function runDetail(
  read: () => Promise<SharedPaperRecord>,
  maxChars: number | undefined,
  cursor: string | undefined,
) {
  try {
    const paper = await read();
    const window = sliceMcpBoundedContent({
      content: paper.content,
      maxChars,
      cursor,
      tool: "get_shared_paper",
      context: { id: paper.id, revision: paper.revision },
    });
    const boundedPaper = { ...paper, content: window.content };
    return {
      content: [{
        type: "text" as const,
        text: sharedPaperDetailContent(boundedPaper),
      }],
      structuredContent: {
        success: true as const,
        data: {
          paper: toDetail(boundedPaper),
          content_metadata: window.metadata,
        },
      },
    };
  } catch (error) {
    if (error instanceof McpBoundedReadCursorError) {
      return createMcpToolError(
        "INVALID_CURSOR",
        "The Shared Paper continuation cursor is invalid or stale. Read the paper again without a cursor.",
      );
    }
    return sharedError(error, "get_shared_paper");
  }
}
async function runMutation(mutate: () => Promise<{ paper: SharedPaperRecord; edit?: SharedPaperEdit; outcome?: "committed" | "replayed" }>, _dependencies: SharedPaperToolDependencies) { try { const result = await mutate(); const replayed = result.outcome === "replayed"; const data = { paper_id: result.paper.id, revision: result.edit?.revision ?? result.paper.revision, ...(result.edit ? { edit_id: result.edit.id, base_revision: result.edit.baseRevision, author: result.edit.author, created_at: result.edit.createdAt.toISOString() } : {}), metadata: { idempotent_replay: replayed }, detail_tool: "get_shared_paper" as const, detail_arguments: { id: result.paper.id } }; return { content: [{ type: "text" as const, text: `Shared paper ${replayed ? "replayed" : "committed"} at revision ${data.revision}.\n${formatMcpDetailPointer("get_shared_paper", data.detail_arguments)}` }], structuredContent: { success: true as const, data } }; } catch (error) { return sharedError(error, "shared_paper_mutation"); } }
async function runLifecycleMutation(mutate: () => Promise<{ paper: SharedPaperRecord; outcome: "committed" | "replayed" }>) {
  try {
    const result = await mutate();
    const data = {
      paper_id: result.paper.id,
      archived_at: result.paper.archivedAt?.toISOString() ?? null,
      metadata: { idempotent_replay: result.outcome === "replayed" },
      detail_tool: "get_shared_paper" as const,
      detail_arguments: { id: result.paper.id },
    };
    return { content: [{ type: "text" as const, text: `Shared paper lifecycle ${result.outcome}; archived_at=${data.archived_at ?? "null"}.\n${formatMcpDetailPointer("get_shared_paper", data.detail_arguments)}` }], structuredContent: { success: true as const, data } };
  } catch (error) { return sharedError(error, "shared_paper_lifecycle"); }
}
async function runDeleteMutation(mutate: () => Promise<{ paperId: string; outcome: "committed" | "replayed" }>) {
  try {
    const result = await mutate();
    const data = { paper_id: result.paperId, deleted: true as const, metadata: { idempotent_replay: result.outcome === "replayed" } };
    return { content: [{ type: "text" as const, text: `Shared paper deletion ${result.outcome}; paper_id=${result.paperId}.` }], structuredContent: { success: true as const, data } };
  } catch (error) { return sharedError(error, "delete_shared_paper"); }
}
async function runEdits(read: () => Promise<SharedPaperEdit[]>, _dependencies: SharedPaperToolDependencies) { try { const edits = await read(); const data = { edits: edits.map(toEdit), count: edits.length }; return { content: [{ type: "text" as const, text: sharedPaperEditsContent(edits) }], structuredContent: { success: true as const, data } }; } catch (error) { return sharedError(error, "list_shared_paper_edits"); } }
function sharedPaperDetailContent(paper: SharedPaperRecord): string {
  const metadata = joinMcpContentLines([
    `Shared paper ${quoteMcpText(paper.title)}`,
    `id=${paper.id}`,
    `revision=${paper.revision}`,
    `created_by=${paper.createdBy}`,
    `updated_by=${paper.updatedBy}`,
    `created_at=${paper.createdAt.toISOString()}`,
    `updated_at=${paper.updatedAt.toISOString()}`,
    `archived_at=${paper.archivedAt?.toISOString() ?? "null"}`,
  ]);
  return paper.content.length > 0 ? `${metadata}\n\n${paper.content}` : metadata;
}

function sharedPaperEditsContent(edits: SharedPaperEdit[]): string {
  const visibleEdits = edits.slice(0, MAX_HISTORY_TEXT_EDITS);
  const lines = [`${edits.length} shared paper edits.`];
  if (visibleEdits.length < edits.length) {
    lines.push(`Showing ${visibleEdits.length} of ${edits.length} returned edits; structuredContent contains all returned edits.`);
  }
  for (const edit of visibleEdits) {
    lines.push(
      `edit=${edit.id}`,
      `author=${edit.author}`,
      `target=${edit.target}`,
      `revision=${edit.baseRevision}->${edit.revision}`,
      `created_at=${edit.createdAt.toISOString()}`,
      `deleted=${quoteMcpText(edit.deletedText, EDIT_TEXT_PREVIEW_CODE_POINTS)}`,
      `inserted=${quoteMcpText(edit.insertedText, EDIT_TEXT_PREVIEW_CODE_POINTS)}`,
    );
  }
  return joinMcpContentLines(lines);
}
function sharedPaperContent(summaries: ReturnType<typeof toSummary>[]) {
  const lines = [`Found ${summaries.length} shared papers.`];
  for (const paper of summaries) {
    const pointer = formatMcpDetailPointer("get_shared_paper", { id: paper.id });
    const excerpt = paper.snippet ?? paper.preview;
    lines.push(`${quoteMcpText(paper.title)} [id=${paper.id}; ${pointer}] — ${quoteMcpText(excerpt)}`);
  }
  return joinMcpContentLines(lines);
}

function toSummary(paper: SharedPaperRecord, query?: string) { return { id: paper.id, title: paper.title, preview: createLeadingPreview(paper.content), snippet: query === undefined ? null : createBodyMatchSnippet(paper.content, query), revision: paper.revision, created_by: paper.createdBy, updated_by: paper.updatedBy, created_at: paper.createdAt.toISOString(), updated_at: paper.updatedAt.toISOString(), archived_at: paper.archivedAt?.toISOString() ?? null, detail_tool: "get_shared_paper" as const, detail_arguments: { id: paper.id } }; }
function toDetail(paper: SharedPaperRecord) { return { id: paper.id, title: paper.title, content: paper.content, revision: paper.revision, created_by: paper.createdBy, updated_by: paper.updatedBy, created_at: paper.createdAt.toISOString(), updated_at: paper.updatedAt.toISOString(), archived_at: paper.archivedAt?.toISOString() ?? null }; }
function toEdit(edit: SharedPaperEdit) { return { id: edit.id, paper_id: edit.paperId, base_revision: edit.baseRevision, revision: edit.revision, author: edit.author, target: edit.target, start_offset: edit.startOffset, end_offset: edit.endOffset, deleted_text: edit.deletedText, inserted_text: edit.insertedText, created_at: edit.createdAt.toISOString() }; }
function sharedError(error: unknown, _tool: string) { if (error instanceof SharedPaperAuthenticationError) return createMcpToolError("AUTHENTICATION_REQUIRED", "Authentication is required for shared papers."); if (error instanceof SharedPaperServiceError) { const status = error.code === "USER_NOT_FOUND" || error.code === "USER_DISABLED" ? "AUTHENTICATION_REQUIRED" : error.code; return createMcpToolError(status, status === "AUTHENTICATION_REQUIRED" ? "Authentication is required for shared papers." : error.message); } return createMcpToolError("INTERNAL_ERROR", "Shared paper service is temporarily unavailable."); }

function boundedCodePointString(rawMax: number, codePointMax: number, min = 0) {
  return z.string().min(min).max(rawMax).refine((value) => codePointLength(value) <= codePointMax, { message: `Value must contain at most ${codePointMax} Unicode code points.` });
}
