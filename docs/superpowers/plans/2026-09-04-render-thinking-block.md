# Render Thinking Block Implementation Plan

> For agentic workers: use this plan as the implementation checklist for the isolated `feat/render-thinking-block` worktree.

**Goal:** Add `render_thinking_block` and its MCP Apps card to LeileiOS while preserving the existing public MCP endpoint, Auth0 authentication, connector, deployment service, and production acceptance baseline.

**Architecture:** Register the tool and versioned UI resource only in the existing public production MCP session factory. Reuse `registerAppTool`, `registerAppResource`, `RESOURCE_MIME_TYPE`, and the existing Streamable HTTP/auth path. Keep the handler stateless: it returns a small rendered status plus the four requested fields in tool-result metadata, with no database, filesystem, logger, telemetry, or capture dependency. Keep the internal namespace and direct core tool registry unchanged.

**Tech Stack:** TypeScript, Zod, `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, existing Node test runner with `tsx`, JSDOM UI tests, Markdown documentation.

## Global Constraints

- Phase A started from `829b3c98011a8aeea083e8a544a89ba6dfb23503`; after explicit #274 production acceptance and #277 OAuth/CIMD production integration, Phase B rebases onto `9e41fefa849c1d15f05eaa3136fbfa15206f8a5d`.
- Keep the PR Draft and do not merge, deploy, or modify Railway until the reviewed release is explicitly authorized.
- Do not touch `main`, `plan/sentinel-ui-consolidation`, #274 history, database schema/migrations, or unrelated MCP tools.
- Preserve the existing `/mcp` endpoint and authentication behavior. The public factory is the authentication boundary; do not add a `noauth` declaration.
- Do not persist or log `thinking`; do not add capture behavior.

## Task 1: Add failing contract tests before production code

**Files:** `tests/render-thinking-block.test.ts`, `tests/mcp-production-resource-wiring.test.ts`.

- Add public production-factory coverage for discovery, Chinese descriptions, required fields, enums, annotations, versioned App metadata, successful metadata-only rendering, invalid input validation, and absence from the internal namespace.
- Add resource coverage for URI, `text/html;profile=mcp-app`, and static HTML delivery.
- Add JSDOM coverage for input/output/result-metadata field sources, partial `window.openai` globals, independent collapse state, theme updates, long-content height limiting, and intrinsic-height notifications.
- Add no-persistence/no-leak assertions using a temporary working directory and a secret marker in success/validation paths; ensure the response content does not duplicate the thinking text.
- Run the focused test file and the affected production-wiring tests now; record the expected RED failures before adding implementation.

## Task 2: Implement the stateless MCP tool

**Files:** `src/mcp/tools/render-thinking-block/register.ts`.

- Define a strict Zod input schema with the four required fields and the Chinese descriptions derived from the reference implementation.
- Define the short structured output `{ success: true, data: { status: "rendered" } }`.
- Register through `registerAppTool` with read-only, non-destructive, idempotent, closed-world annotations and the versioned resource URI.
- Return only a short content status and `_meta` containing `style`, `thinking`, `effort`, and `skin`; never write or log the input.

## Task 3: Implement the versioned MCP Apps resource

**Files:** `src/mcp/tools/render-thinking-block/resource.ts`.

- Port the reference card behavior into a dependency-free static HTML resource with LeileiOS-specific styling and URI `ui://widget/leileios-thinking-block-v1.html`.
- Include botanical and microglow skins, style/effort/skin badges, independent per-card collapse state, light/dark theme handling, scrollable long content, partial-global merging, and robust input/output/result-metadata extraction.
- Preserve `window.openai` compatibility and call `notifyIntrinsicHeight` after rendering, collapse changes, and relevant layout changes.
- Register with the existing Apps resource helper and `RESOURCE_MIME_TYPE`, including only static UI metadata and no external resource domains.

## Task 4: Wire only the public production MCP namespace

**Files:** `src/mcp/server/production-server-factory.ts`, `tests/mcp-production-resource-wiring.test.ts`.

- Register the new tool and resource for `namespace === "public"` using the current factory.
- Leave direct core count, internal namespace, endpoint, auth middleware, transport, and all existing service wiring unchanged.
- Update only the expected public tool count and add explicit public/internal assertions.

## Task 5: Document the feature and reference attribution

**Files:** `README.md` (or the repository’s existing MCP documentation location if inspection shows a more appropriate section).

- Explain the purpose, external model-written working text versus hidden native CoT, default no-persistence behavior, recommended invocation, connector refresh after deployment, and MIT attribution to `sibylsea-hub/gpt-thinking-block-mcp`.
- Do not phrase the example as a mandatory every-turn rule.

## Task 6: Verify, inspect, and hand off

- Run the focused tests, all relevant MCP/App tests, TypeScript checks, build, database check, and the full existing test suite using the repository’s documented commands (or the exact local equivalent if the package-manager signature issue persists).
- Inspect `git diff --check`, the complete diff, changed-file scope, generated resource URI/MIME, auth behavior, and search for accidental thinking-body logging or persistence.
- Run the repository security/diff review workflow if available, then commit and push `feat/render-thinking-block` and create a Draft PR only.
- Report branch, commit, Draft PR, files, tests, #274 conflict assessment, and remaining pre-deployment steps; stop before merge/deploy/Railway changes.
