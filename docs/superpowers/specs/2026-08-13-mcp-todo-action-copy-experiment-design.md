# MCP Todo action copy experiment

## Goal

Determine whether ChatGPT is refusing to invoke `write_todo_paper` because of the tool's presentation/risk wording rather than Leilei OS backend behavior.

## Scope

Change only the user-facing `title` and `description` metadata for `write_todo_paper` so they match the tone and structure of the existing working MCP write tools.

No changes to:
- tool name
- input schema
- output schema
- `destructiveHint`
- `idempotentHint`
- authentication
- Todo service/repository behavior
- revision semantics
- idempotency semantics
- database schema or migrations
- any other MCP tool

## Proposed copy

Title:
`Save one Todo paper`

Description:
`Save one complete L or G Todo paper in Leilei OS. Supply an exact YYYY-MM-DD date, the logical author, the exact current revision returned by read_todo_day (or null only when creating a missing paper), the complete ordered entry list, and a stable idempotency key. The authenticated user is assigned by the server.`

## Why this experiment

The existing working write tools use neutral verbs such as `Create`, `Write`, `Set`, and `Stop`. `write_todo_paper` uniquely presents itself as `Replace one complete Todo paper` and repeats full replacement language in its description. The backend behavior will remain unchanged; this experiment isolates only the metadata exposed to ChatGPT.

## Acceptance

1. Diff contains only this spec plus the `write_todo_paper` title/description metadata change.
2. Existing MCP contract and Todo tests still pass.
3. Deploy the exact experiment commit to the accepted branch only after verification.
4. Refresh the ChatGPT app tool metadata and run one minimal authenticated production test: read an existing paper, explicitly approve the exact unchanged ordered entries, then invoke `write_todo_paper` once.
5. If ChatGPT now emits the tool call, continue the previously frozen idempotency/revision smoke. If it still stops before the tool call, revert the copy experiment and investigate another client-side/tool-metadata difference.
