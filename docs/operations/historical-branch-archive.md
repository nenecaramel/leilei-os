# Historical branch archive

`main` is the only integration and release trunk. The branches below are
retained as historical references only; they are not product development
lines and must not be merged into `main`.

## Branch-reference gate

- `ACTIVE_REF` means a branch name used by a workflow trigger, deployment
  configuration, checkout/ref, script, or automation. An active reference
  blocks deletion of that branch.
- `HISTORICAL_REF` means an archive or design/provenance reference that is
  bound to a fixed tip SHA. Historical references do not block deletion.

This document is the source of the fixed-SHA provenance for the historical
references below; it is not an instruction to check out or deploy those
branches.

## Current Notion capability

The current `main` tree is not read-only for Notion. Authenticated production
MCP sessions use the explicit-write registrar for `write_notion_page`
(`create`, `update`, and `update_content`) and `write_notion_comment`
(`create` and `reply`), with server-side credentials and fresh readback
verification. The broader historical client/tool experiments remain archived
and must not be mistaken for the active production contract.

## Archive-only branches

| Branch | Tip SHA | Purpose | Why it does not enter `main` | Classification |
| --- | --- | --- | --- | --- |
| `agent/oauth-probe` | `8f453cd8a99746a647aec421d89bebe4bf6fc0fe` | Isolated OAuth/MCP probe with its own Docker context and tests. | Experimental code under `experiments/oauth-probe/`; not wired into the product runtime. | historical/archive only |
| `docs/day-space-real-data-design` | `2da38e1c6c787f4efbb8f201d86a89874f658599` | Historical Day Space real-data design and date-resolution specification. | Day Space implementation is already on `main`; this branch contains design history only. | historical/archive only |
| `docs/todo-foundation-design` | `4e60f359ed96f437cdc7867ff1f7b8d2d56f58a1` | Historical Todo Foundation design specification. | Todo Foundation implementation is already on `main`; the branch is specification history only. | historical/archive only |
| `feat/notion-global-write` | `e41cae1dd02562eba3c4c0acec74d87eb1a3d66d` | Notion write-surface experiments and risk-review reverts. | The old branch is a superseded experiment/review line. The explicit Notion write implementation is present on current `main`; this historical branch must not be used as an integration target. | historical/archive only |
| `fix/notion-write-runtime-smoke` | `0b6a4c5e460bf1ed5db231c571815f5ca514822a` | Historical Notion/migration runtime smoke and ledger-order checks. | `main` contains the later migration diagnostics and ordering behavior; this line is incident evidence, not current code. | historical/archive only |
| `verify/notion-production-smoke-20260813` | `2ee6892bd237027e43c27b9e451b62febe86bb93` | Historical production Notion MCP smoke workflow. | It records a past deployment verification and is not part of the current product release path. | historical/archive only |

## Migration fingerprint history

| Branch | Tip SHA | Purpose | Why it does not enter `main` | Classification |
| --- | --- | --- | --- | --- |
| `fix/migration-error-fingerprint` | `7b6e81ebe69404ba649ac388d77b31d153a1e197` | Original proposal for a sanitized migration failure fingerprint regression test. | The valuable test was reimplemented against the current `safeErrorCode` contract and merged by PR #163. The old branch is no longer needed. | historical/archive only |
| `codex/migration-error-fingerprint-regression` | `0f51fa46d7521edbf5c3aa06e4733d77a43ee8b1` | Current implementation branch for the corrected regression test. | Merged into `main` by PR #163; retained only until routine remote cleanup confirms GitHub did not auto-delete it. | historical/archive only |
