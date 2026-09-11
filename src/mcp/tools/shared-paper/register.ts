import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SharedPaperServiceError } from "../../../domains/shared-paper/shared-paper-service.js";
import type { SharedPaperEdit, SharedPaperRecord } from "../../../domains/shared-paper/shared-paper-types.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { formatMcpDetailPointer, joinMcpContentLines, quoteMcpText } from "../content-contract.js";
import { MCP_IDEMPOTENCY_KEY_MAX_LENGTH, MCP_IDEMPOTENCY_KEY_MIN_LENGTH, MCP_IDEMPOTENCY_KEY_PATTERN } from "../../../domains/mcp-write/mcp-write-idempotency.js";
import { createBodyMatchSnippet, createLeadingPreview } from "../../../domains/compact-text.js";
import { codePointLength } from "../../../shared/unicode.js";

const idSchema = z.string().uuid();
const authorSchema = z.enum(["L", "G", "C"]);
const idempotencyKeySchema = z.string().min(MCP_IDEMPOTENCY_KEY_MIN_LENGTH).max(MCP_IDEMPOTENCY_KEY_MAX_LENGTH).regex(MCP_IDEMPOTENCY_KEY_PATTERN);
const EDIT_TEXT_PREVIEW_CODE_POINTS = 200;
const MAX_HISTORY_TEXT_EDITS = 5;
const paperSummarySchema = z.object({ id: idSchema, title: z.string(), preview: z.string(), snippet: z.string().nullable(), revision: z.number().int().min(1), created_by: authorSchema, updated_by: authorSchema, created_at: z.string().datetime(), updated_at: z.string().datetime(), detail_tool: z.literal("get_shared_paper"), detail_arguments: z.object({ id: idSchema }).strict() }).strict();
const paperDetailSchema = z.object({ id: idSchema, title: z.string(), content: z.string(), revision: z.number().int().min(1), created_by: authorSchema, updated_by: authorSchema, created_at: z.string().datetime(), updated_at: z.string().datetime() }).strict();
const editSchema = z.object({ id: idSchema, paper_id: idSchema, base_revision: z.number().int().min(1), revision: z.number().int().min(2), author: authorSchema, start_offset: z.number().int().nonnegative(), end_offset: z.number().int().nonnegative(), deleted_text: z.string(), inserted_text: z.string(), created_at: z.string().datetime() }).strict();
const listInput = z.object({ limit: z.number().int().min(1).max(100).optional() }).strict();
const searchInput = z.object({ query: boundedCodePointString(400, 200, 1), limit: z.number().int().min(1).max(100).optional() }).strict();
const getInput = z.object({ id: idSchema }).strict();
const createInput = z.object({ title: boundedCodePointString(400, 200, 1), content: boundedCodePointString(200_000, 100_000), author: authorSchema, idempotency_key: idempotencyKeySchema }).strict();
const editInput = z.object({ id: idSchema, expected_revision: z.number().int().min(1), author: authorSchema, match_text: boundedCodePointString(200_000, 100_000), replacement_text: boundedCodePointString(200_000, 100_000), idempotency_key: idempotencyKeySchema }).strict();
const editsInput = z.object({ id: idSchema, limit: z.number().int().min(1).max(100).optional(), before_revision: z.number().int().min(1).optional() }).strict();
const listOutput = z.object({ success: z.boolean(), data: z.object({ papers: z.array(paperSummarySchema), count: z.number().int().nonnegative() }).optional(), error: mcpToolErrorDetailsSchema.optional() }).strict();
const searchOutput = listOutput;
const getOutput = z.object({ success: z.boolean(), data: z.object({ paper: paperDetailSchema }).optional(), error: mcpToolErrorDetailsSchema.optional() }).strict();
const mutationOutput = z.object({ success: z.boolean(), data: z.object({ paper_id: idSchema, revision: z.number().int().min(1), edit_id: idSchema.optional(), base_revision: z.number().int().min(1).optional(), author: authorSchema.optional(), created_at: z.string().datetime().optional(), metadata: z.object({ idempotent_replay: z.boolean() }).strict(), detail_tool: z.literal("get_shared_paper"), detail_arguments: z.object({ id: idSchema }).strict() }).optional(), error: mcpToolErrorDetailsSchema.optional() }).strict();
const editsOutput = z.object({ success: z.boolean(), data: z.object({ edits: z.array(editSchema), count: z.number().int().nonnegative() }).optional(), error: mcpToolErrorDetailsSchema.optional() }).strict();

export interface SharedPaperToolService {
  listPapers(input: { userId: string; limit?: number }): Promise<SharedPaperRecord[]>;
  searchPapers(input: { userId: string; query: unknown; limit?: number }): Promise<SharedPaperRecord[]>;
  getPaper(input: { userId: string; paperId: string }): Promise<SharedPaperRecord>;
  listEdits(input: { userId: string; paperId: string; limit?: number; beforeRevision?: number }): Promise<SharedPaperEdit[]>;
  createPaperIdempotently(input: { userId: string; title: string; content: string; author: "L" | "G" | "C"; idempotencyKey: string }): Promise<{ paper: SharedPaperRecord; outcome: "committed" | "replayed" }>;
  editPaperByMatch(input: { userId: string; paperId: string; expectedRevision: number; author: "L" | "G" | "C"; matchText: string; replacementText: string; idempotencyKey: string }): Promise<{ paper: SharedPaperRecord; edit: SharedPaperEdit; outcome?: "committed" | "replayed" }>;
}

export type SharedPaperToolDependencies = { sharedPaperService: SharedPaperToolService; getAuthenticatedUserId: () => string };

export class SharedPaperAuthenticationError extends Error {
  constructor() { super("Authenticated MCP user context is unavailable."); this.name = "SharedPaperAuthenticationError"; }
}

export function registerSharedPaperTools(server: McpServer, dependencies: SharedPaperToolDependencies): void {
  server.registerTool("list_shared_papers", { title: "List shared papers", description: "List shared papers owned by the authenticated user. Results are compact discovery records; use get_shared_paper for full content.", inputSchema: listInput, outputSchema: listOutput, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ limit }) => runRead(() => dependencies.sharedPaperService.listPapers({ userId: dependencies.getAuthenticatedUserId(), limit }), "list_shared_papers", dependencies));
  server.registerTool("search_shared_papers", { title: "Search shared papers", description: "Search the authenticated user's shared paper titles and canonical content using normalized substring matching. Results are compact; use get_shared_paper for full content.", inputSchema: searchInput, outputSchema: searchOutput, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ query, limit }) => runRead(() => dependencies.sharedPaperService.searchPapers({ userId: dependencies.getAuthenticatedUserId(), query, limit }), "search_shared_papers", dependencies, query));
  server.registerTool("get_shared_paper", { title: "Read a shared paper", description: "Read the exact canonical content of one shared paper.", inputSchema: getInput, outputSchema: getOutput, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ id }) => runDetail(() => dependencies.sharedPaperService.getPaper({ userId: dependencies.getAuthenticatedUserId(), paperId: id }), dependencies));
  server.registerTool("create_shared_paper", { title: "Create a shared paper", description: "Create one shared paper with a single canonical content body. L, G, and C are provenance authors only; provide a stable idempotency_key for safe replay.", inputSchema: createInput, outputSchema: mutationOutput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ title, content, author, idempotency_key }) => runMutation(() => dependencies.sharedPaperService.createPaperIdempotently({ userId: dependencies.getAuthenticatedUserId(), title, content, author, idempotencyKey: idempotency_key }), dependencies));
  server.registerTool("edit_shared_paper", { title: "Edit a shared paper", description: "Apply one unique exact match replacement to the shared paper's canonical content. Supply the expected revision and stable idempotency_key; stale revisions are rejected and no automatic merge occurs.", inputSchema: editInput, outputSchema: mutationOutput, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ id, expected_revision, author, match_text, replacement_text, idempotency_key }) => runMutation(async () => { const result = await dependencies.sharedPaperService.editPaperByMatch({ userId: dependencies.getAuthenticatedUserId(), paperId: id, expectedRevision: expected_revision, author, matchText: match_text, replacementText: replacement_text, idempotencyKey: idempotency_key }); return { ...result, edit: result.edit }; }, dependencies));
  server.registerTool("list_shared_paper_edits", { title: "List shared paper edits", description: "List committed save-level deltas for one shared paper. Use before_revision to continue with older revisions.", inputSchema: editsInput, outputSchema: editsOutput, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ id, limit, before_revision }) => runEdits(() => dependencies.sharedPaperService.listEdits({ userId: dependencies.getAuthenticatedUserId(), paperId: id, limit, beforeRevision: before_revision }), dependencies));
}

async function runRead(read: () => Promise<SharedPaperRecord[]>, tool: string, dependencies: SharedPaperToolDependencies, query?: string) {
  try { const papers = await read(); const summaries = papers.map((paper) => toSummary(paper, query)); return { content: [{ type: "text" as const, text: sharedPaperContent(summaries) }], structuredContent: { success: true as const, data: { papers: summaries, count: summaries.length } } }; }
  catch (error) { return sharedError(error, tool); }
}
async function runDetail(read: () => Promise<SharedPaperRecord>, dependencies: SharedPaperToolDependencies) { try { const paper = await read(); return { content: [{ type: "text" as const, text: sharedPaperDetailContent(paper) }], structuredContent: { success: true as const, data: { paper: toDetail(paper) } } }; } catch (error) { return sharedError(error, "get_shared_paper"); } }
async function runMutation(mutate: () => Promise<{ paper: SharedPaperRecord; edit?: SharedPaperEdit; outcome?: "committed" | "replayed" }>, _dependencies: SharedPaperToolDependencies) { try { const result = await mutate(); const replayed = result.outcome === "replayed"; const data = { paper_id: result.paper.id, revision: result.edit?.revision ?? result.paper.revision, ...(result.edit ? { edit_id: result.edit.id, base_revision: result.edit.baseRevision, author: result.edit.author, created_at: result.edit.createdAt.toISOString() } : {}), metadata: { idempotent_replay: replayed }, detail_tool: "get_shared_paper" as const, detail_arguments: { id: result.paper.id } }; return { content: [{ type: "text" as const, text: `Shared paper ${replayed ? "replayed" : "committed"} at revision ${data.revision}.\n${formatMcpDetailPointer("get_shared_paper", data.detail_arguments)}` }], structuredContent: { success: true as const, data } }; } catch (error) { return sharedError(error, "shared_paper_mutation"); } }
async function runEdits(read: () => Promise<SharedPaperEdit[]>, _dependencies: SharedPaperToolDependencies) { try { const edits = await read(); const data = { edits: edits.map(toEdit), count: edits.length }; return { content: [{ type: "text" as const, text: sharedPaperEditsContent(edits) }], structuredContent: { success: true as const, data } }; } catch (error) { return sharedError(error, "list_shared_paper_edits"); } }
function sharedPaperDetailContent(paper: SharedPaperRecord): string {
  return joinMcpContentLines([
    `Shared paper ${quoteMcpText(paper.title)}`,
    `id=${paper.id}`,
    `revision=${paper.revision}`,
    `created_by=${paper.createdBy}`,
    `updated_by=${paper.updatedBy}`,
    `created_at=${paper.createdAt.toISOString()}`,
    `updated_at=${paper.updatedAt.toISOString()}`,
    paper.content,
  ]);
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

function toSummary(paper: SharedPaperRecord, query?: string) { return { id: paper.id, title: paper.title, preview: createLeadingPreview(paper.content), snippet: query === undefined ? null : createBodyMatchSnippet(paper.content, query), revision: paper.revision, created_by: paper.createdBy, updated_by: paper.updatedBy, created_at: paper.createdAt.toISOString(), updated_at: paper.updatedAt.toISOString(), detail_tool: "get_shared_paper" as const, detail_arguments: { id: paper.id } }; }
function toDetail(paper: SharedPaperRecord) { return { id: paper.id, title: paper.title, content: paper.content, revision: paper.revision, created_by: paper.createdBy, updated_by: paper.updatedBy, created_at: paper.createdAt.toISOString(), updated_at: paper.updatedAt.toISOString() }; }
function toEdit(edit: SharedPaperEdit) { return { id: edit.id, paper_id: edit.paperId, base_revision: edit.baseRevision, revision: edit.revision, author: edit.author, start_offset: edit.startOffset, end_offset: edit.endOffset, deleted_text: edit.deletedText, inserted_text: edit.insertedText, created_at: edit.createdAt.toISOString() }; }
function sharedError(error: unknown, _tool: string) { if (error instanceof SharedPaperAuthenticationError) return createMcpToolError("AUTHENTICATION_REQUIRED", "Authentication is required for shared papers."); if (error instanceof SharedPaperServiceError) { const status = error.code === "USER_NOT_FOUND" || error.code === "USER_DISABLED" ? "AUTHENTICATION_REQUIRED" : error.code; return createMcpToolError(status, status === "AUTHENTICATION_REQUIRED" ? "Authentication is required for shared papers." : error.message); } return createMcpToolError("INTERNAL_ERROR", "Shared paper service is temporarily unavailable."); }

function boundedCodePointString(rawMax: number, codePointMax: number, min = 0) {
  return z.string().min(min).max(rawMax).refine((value) => codePointLength(value) <= codePointMax, { message: `Value must contain at most ${codePointMax} Unicode code points.` });
}
