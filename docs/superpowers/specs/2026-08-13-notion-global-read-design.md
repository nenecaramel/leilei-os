# Notion Global Read Design

> Historical/superseded design. This was the original read-only Notion phase;
> the current `main` tree also exposes the explicit
> `write_notion_page`/`write_notion_comment` surface. Keep this file for
> provenance, not as the current production contract or deployment guide.

## Goal

Give the authenticated Leilei OS MCP user read-only access to the creator's whole Notion workspace through a Notion Personal Access Token (PAT), without adding any Notion write capability.

## Scope

First version exposes exactly two MCP tools:

- `search_notion`: search accessible Notion pages by title.
- `read_notion_page`: retrieve one page and render its block content into bounded plain text.

The PAT is user-scoped, so content access follows the Notion permissions of the user who created the token. No per-page Leilei OS allowlist is added.

## Authentication and secrets

- Railway stores the PAT in `NOTION_PAT`.
- The PAT is never accepted from MCP input, returned from MCP output, logged, stored in PostgreSQL, or exposed to the Web app.
- The PAT must be created with `Read content` capability only for this phase.
- Leilei OS MCP authentication remains mandatory. The Notion tools call the existing authenticated-user resolver before any upstream request.

## Notion API contract

- REST base: `https://api.notion.com/v1`.
- Frozen API version: `2026-03-11`.
- Every request sends `Authorization: Bearer <NOTION_PAT>`, `Notion-Version: 2026-03-11`, and JSON content headers where needed.
- No new SDK dependency is required; the adapter uses the runtime `fetch` implementation.

### Search

`search_notion` calls `POST /v1/search` with an object filter of `page`. Notion's public Search endpoint is title-based; this version does not pretend to provide full-text search across page bodies.

Input:

- `query`: NFC-normalized, trimmed, 1-200 Unicode code points.
- `limit`: optional integer 1-25, default 10.
- `cursor`: optional Notion pagination cursor.

Output per result:

- `id`
- `title`
- `url`
- `last_edited_time`

Metadata contains `count`, `has_more`, and `next_cursor`.

### Read page

`read_notion_page` calls `GET /v1/pages/{page_id}` and paginated `GET /v1/blocks/{block_id}/children?page_size=100`.

The adapter renders common block types to readable text, including headings, paragraphs, lists, to-do items, quotes, callouts, code, dividers, table rows, links, equations, and child-page/database labels.

Nested structural blocks are traversed, but child pages and child databases are listed rather than recursively expanding their own contents. A caller can explicitly pass a returned child page ID to `read_notion_page` when it wants that page.

Bounds:

- maximum traversal depth: 8
- maximum blocks read: 500
- maximum rendered text: 60,000 characters
- output reports `block_count` and `truncated`

These bounds prevent one tool call from recursively consuming an unbounded workspace.

## Errors

MCP errors use stable user-facing categories and never include upstream response bodies or secrets:

- not configured
- authentication/access denied
- page not found or inaccessible
- rate limited
- temporarily unavailable

## MCP annotations

Both tools are:

- `readOnlyHint: true`
- `destructiveHint: false`
- `idempotentHint: true`
- `openWorldHint: true`

`openWorldHint` is true because Notion is an external data source.

## Repository impact

Create:

- `src/domains/notion/notion-read-client.ts`
- `src/mcp/tools/search-notion/register.ts`
- `src/mcp/tools/read-notion-page/register.ts`
- `tests/notion-read-client.test.ts`
- `tests/notion-mcp-tools.test.ts`

Modify:

- `src/config/env.ts`
- `.env.example`
- `src/mcp/server/create-server.ts`

No database schema or migration changes.

## Acceptance

- PAT is server-only and optional at process startup.
- Both tools remain inaccessible without Leilei OS MCP authentication.
- Search returns only pages and never accepts a user ID or token.
- Read page correctly paginates block children and renders nested structural blocks within bounds.
- Child pages are not silently recursively expanded.
- 401/403/404/429/upstream failures map to safe MCP errors.
- Existing MCP tools and write boundaries remain unchanged.
- Typecheck/build and focused/full test suites pass before production merge.
