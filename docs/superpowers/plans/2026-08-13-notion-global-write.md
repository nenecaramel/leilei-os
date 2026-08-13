# Notion Global Write Implementation Plan

**Goal:** Extend LeileiOS from Notion global read-only access to the current Notion API `2026-03-11` write surface exposed to the configured PAT, with no LeileiOS-side confirmation gate.

**Architecture:** Preserve `search_notion` and `read_notion_page`; share one server-side Notion transport; add focused page/block, structure, comment, file-upload, and meeting-note clients; register eight explicit authenticated write tools on production MCP sessions.

**Constraints:** `NOTION_PAT` stays server-only. No page allowlist, raw HTTP passthrough, synthetic `confirm=true`, migration, PWA change, or automatic retry of non-idempotent writes.

### Task 1: Shared transport and read regression

- [x] Add `src/domains/notion/notion-transport.ts` with fixed relative endpoint paths, API version/auth headers, FormData handling, and safe error mapping.
- [x] Refactor `NotionReadClient` onto the shared transport without changing the read/search MCP contract.
- [x] Add transport/read regression tests.

### Task 2: Page and block mutations

- [x] Add page create/update/move/Markdown-content/trash/restore support.
- [x] Add block append/insert/update/delete/restore support.
- [x] Keep caller-supplied IDs inside fixed endpoint templates only.
- [x] Add request-shape tests.

### Task 3: Database, data-source, and view mutations

- [x] Add database create/update/trash/restore.
- [x] Add data-source create/update/trash/restore including native property removal through `null` payloads.
- [x] Add view create/update/permanent delete.
- [x] Add request-shape tests.

### Task 4: Comments, files, and AI Meeting Notes

- [x] Add comment create/reply/update/delete.
- [x] Add file-upload create/send/complete with JSON create bodies and FormData byte transfer.
- [x] Add `POST /blocks/meeting_notes` creation through a focused meeting-note client.
- [x] Add unit contracts for all three resources.

### Task 5: Eight authenticated MCP write tools

- [x] `write_notion_page`
- [x] `write_notion_block`
- [x] `write_notion_database`
- [x] `write_notion_data_source`
- [x] `write_notion_view`
- [x] `write_notion_comment`
- [x] `upload_notion_file`
- [x] `create_notion_meeting_note`

Public schemas expose neither PAT/token, user identity, arbitrary endpoint URLs, nor a confirmation field. Mutation results use `{ success: true, data: ... }`; errors are sanitized.

### Task 6: Production session wiring

- [x] Add focused `register-notion-writes.ts` composition instead of enlarging the base server factory.
- [x] Lazily share one production transport from `env.NOTION_PAT` across focused clients.
- [x] Register write tools only on authenticated production MCP sessions in `router.ts`.
- [x] Preserve the base 21-tool MCP surface used by existing unit tests; production sessions add the eight write tools.

### Task 7: Deterministic verification gate

- [x] Add focused Notion global-write workflow.
- [x] Install Web dependencies before root tests that import Web modules.
- [x] Run focused Notion contracts serially.
- [x] Run every repository test file in an isolated process; retry once and isolate only unchanged production-baseline UI timing flakes.
- [x] Root `pnpm typecheck`.
- [x] Root `pnpm build`.
- [x] Web typecheck/build.
- [x] `git diff --check`.
- [x] Compare feature branch against production and confirm no migration/PWA/unrelated product-code changes.

### Task 8: Production and disposable live smoke

- [ ] Fast-forward `feat/notion-global-write` to `codex/phase-6-web-ui-foundation` with `force:false` only after the complete verification gate is green.
- [ ] Wait for Railway and Vercel success.
- [ ] Through a fresh authenticated LeileiOS MCP session, create a disposable page, update title/content, append/update a block, trash/restore, and read back.
- [ ] Exercise disposable database/data-source/view/comment/file-upload paths where the workspace permits them.
- [ ] Exercise Meeting Note creation only with a disposable supported source; if Notion blocks it by workspace/plan capability, record that upstream limitation rather than treating it as a LeileiOS failure.
- [ ] Clean up disposable content and record exact production SHA/status evidence.
