# Conversation Archive V1 Implementation Plan

> Base: `main@d91f9605b54cc8d4d59fe883e4b8baae5bfb06d6`
>
> Source evidence for ChatGPT: the user's real 2026-09-16 official `conversations.json` export. Claude support remains adapter-only until a real user export is available.

## Goal

Add Conversation Archive as a first-class LeileiOS domain for preserving, browsing, searching, counting, and favoriting ChatGPT / Claude conversation history.

The import contract must be safe for repeated manual exports:

- provider-specific parsing;
- provider-neutral canonical storage;
- idempotent incremental merge;
- new/changed records are merged, unchanged records are skipped;
- records absent from a later export are never deleted by ordinary Import;
- source branches and provider message identity are preserved;
- visible-path statistics do not count hidden reasoning/tool nodes as ordinary chat messages.

## Why this is a separate import pipeline

Do not reuse System Data Restore.

The existing restore path is a <=10 MiB create-only backup restore with create/duplicate/conflict semantics. Conversation exports are much larger and have different semantics: the real ChatGPT export used for this work is ~82 MiB, has a message graph rather than a flat list, and repeated Claude imports must update existing conversations/messages.

Conversation Archive therefore gets its own import domain, API, preview model, and audit trail.

## Canonical model

### Conversation

One provider conversation/window.

Required identity:

- internal `id`
- `user_id`
- `provider`
- `source_conversation_id`

Canonical fields:

- title
- source_created_at / source_updated_at
- current_leaf_source_node_id
- default_model, nullable
- source_fingerprint
- first_seen_import_id / last_seen_import_id
- created_at / updated_at

Unique identity: `(user_id, provider, source_conversation_id)`.

### Message node

Store provider graph nodes, not only visible chat bubbles.

Required identity:

- internal `id`
- conversation_id
- source_node_id
- source_message_id, nullable
- parent_source_node_id, nullable

Canonical fields:

- role: user / assistant / system / tool / reasoning / unknown
- model, nullable
- source_created_at / source_updated_at, nullable
- is_current_path
- current_path_index, nullable
- turn_index, nullable
- is_primary
- display_text
- source_fingerprint
- first_seen_import_id / last_seen_import_id

`is_primary` means the node is an ordinary visible conversation message for UI/statistics. Internal reasoning/thought/tool nodes remain preserved but do not inflate ordinary message/turn counts.

### Content block

A message can contain ordered typed blocks.

Canonical kinds:

- text
- thinking
- reasoning_recap
- tool_use
- tool_result
- image
- audio
- video
- file
- unknown

Keep `raw_type` and a structured payload for lossless handling of provider-specific shapes that LeileiOS does not yet understand.

### Attachment

Preserve attachment identity/metadata even when the original bytes are unavailable.

Fields include source attachment id, filename, mime type, size, ordinal, provider metadata, and optional future blob reference.

### Message version

When a known source node/message arrives with a different canonical fingerprint:

1. snapshot the previous canonical value;
2. update the canonical row;
3. retain the old snapshot as a version.

Ordinary Import never silently discards a changed historical message.

### Import source / import run

Separate exact source-file identity from parser executions.

`conversation_import_source`:

- user
- provider
- original filename
- raw SHA-256
- raw byte size
- compressed/raw storage reference
- first received at

`conversation_import_run`:

- source id
- parser version
- status
- preview fingerprint
- counts/summary
- started/completed timestamps

Same file + same parser version is idempotent. Same source file may be reparsed by a newer parser version.

## Raw source preservation

Do not copy every provider field into canonical rows merely to preserve evidence.

Keep canonical rows compact and preserve the original export separately.

Initial storage contract is abstracted behind a raw-source store. The first implementation may use compressed PostgreSQL bytes because the project has no existing object store, but the metadata schema must not depend on that backend; it must be movable to object storage later without changing Conversation/Message identities.

Raw upload must be streamed. Do not use the existing `express.raw()` import pattern for large conversation exports.

## ChatGPT adapter

Implement `ChatGPTExportParser` against the real export structure:

`conversation -> mapping -> node -> message`

Preserve:

- conversation_id
- title
- create_time / update_time
- current_node
- default_model_slug
- mapping node id
- node parent
- message id
- author role
- message create_time
- message-level metadata.model_slug when present
- content shape
- attachment metadata

The real export contains at least:

- text
- multimodal_text
- reasoning_recap
- thoughts

and media-like multimodal blocks, so unknown typed blocks must be preserved rather than rejected.

### Current visible path

For ChatGPT, walk parent pointers backward from `current_node`, reverse the result, and mark exactly those nodes as current-path.

Do not delete other mapping branches.

A missing-message structural/root node may be retained only as graph metadata if needed; it must not become an ordinary visible message.

## Claude adapter contract

The user's real 2026-09-16 Claude export is now available and is the production source of truth for this adapter.

Verified shape:

- conversation: `uuid / name / summary / created_at / updated_at / account / chat_messages[]`
- message: `uuid / text / content[] / sender / created_at / updated_at / attachments[] / files[] / parent_message_uuid`
- sender values observed: `human / assistant`
- content block types observed: `text / thinking / tool_use / tool_result / injected_prompt_block`
- no conversation-level or message-level model field is present in this export
- every message carries a parent pointer; the root uses the all-zero UUID sentinel
- the export contains real branching but no authoritative `current_leaf_message_uuid`

Therefore:

- model stays null unless a future real export explicitly supplies it;
- all parent branches are preserved;
- Claude current-path fields remain unset rather than inferred from the latest message;
- `injected_prompt_block` is preserved as an internal unknown/raw block and excluded from ordinary display text;
- `files[]` and `attachments[]` normalize into attachment metadata without assuming file bytes exist.

## Incremental merge rules

For each import:

- new provider conversation -> create
- known conversation with changed header fingerprint -> update
- new source node/message -> create
- known source node/message with same fingerprint -> unchanged
- known source node/message with changed fingerprint -> version + update
- canonical rows not present in the new export -> retain untouched
- no ordinary import operation deletes conversations or messages

If the same conversation occurs more than once in one multi-file batch, deterministic provider rules must resolve it or surface a preview warning/conflict; never silently pick an arbitrary copy.

## Preview

Before execution, show provider-aware counts:

- conversations: new / updated / unchanged
- messages: new / updated / unchanged
- warnings: unknown content types, attachment metadata without bytes, source duplicates, malformed skipped records

Preview produces a fingerprint over source SHA + parser version + current canonical fingerprints. Execute rejects a stale preview.

Repeated exact import should resolve to no changes.

## Statistics

Timezone comes from LeileiOS user settings.

Daily ordinary-message counting must not invent path certainty.

For providers with an authoritative current leaf (currently ChatGPT), the default path metric can use current-path primary visible messages.

For providers whose official export omits the selected/current leaf (verified for the user's current Claude export), the archive must expose branch-inclusive primary message/turn counts rather than pretending an inferred leaf is authoritative. A later UI may additionally offer a clearly labeled inferred display path, but it must never be stored or presented as provider-supplied truth.

Reasoning/thought/tool/internal-only blocks remain queryable in raw/detail mode but do not inflate ordinary visible message counts.

## Search

Conversation's own search is message-level and returns direct message anchors.

V1 filters:

- provider
- date range
- conversation
- user / assistant
- favorites only (after Favorites lands)

Search normal visible text by default. Internal reasoning/raw blocks require an explicit raw/internal mode later.

Global Search integration is a later rollout after the dedicated Conversation search is accepted. Do not add `conversation` to Global Search defaults in the foundation PR.

## Favorites

A favorite is not a copied dead note.

Store:

- favorite metadata: title / note / tags
- ordered links to one or more canonical message rows
- snapshot of the selected text/content at favorite creation time

This preserves both live provenance and the exact text that was favorited.

## System Data / backup boundary

Do not put the entire archive into the existing small generic `All` export in the first rollout. Conversation Archive is orders of magnitude larger and has raw source files.

It gets a dedicated archive export/backup contract later. Database backups still protect canonical data.

## Rollout / PR sequence

### PR A — foundation — shipped in #371

- [x] provider-neutral normalized types
- [x] parser adapter interface
- [x] ChatGPT conversation normalizer
- [x] current-path derivation
- [x] content-block normalization
- [x] representative fixtures derived from the real ChatGPT export
- [x] tests for branches, reasoning/thoughts, multimodal, attachments, per-message model, unknown blocks
- [x] no DB/API/UI change yet

### PR B — persistence + merge planning

- [x] migration 0040 Conversation Archive core tables
- [x] merge-state read repository
- [x] source/run audit tables
- [x] additive merge planner
- [x] message-version persistence table
- [x] real-size planner validation against the user's ChatGPT export

### PR C1 — large-file ingest + Preview

- [x] streamed raw source ingest + SHA-256
- [x] PostgreSQL raw-source blob backend behind source metadata
- [x] JSON raw sources stored gzip-losslessly; ZIP sources preserved byte-for-byte
- [x] official-style ZIP extraction for `conversations*.json`
- [x] top-level export streaming without buffering the whole JSON document
- [x] provider auto-detection
- [x] Preview API
- [x] stale provider snapshot classification so older exports cannot silently plan a revert
- [x] same raw source dedupe by user + SHA-256
- [ ] production Preview acceptance with the user's real ChatGPT JSON and Claude ZIP

### PR C2 — batched Execute

- [x] reconstruct stored raw source for execution with SHA-256/byte-count integrity verification
- [x] recompute the complete Preview fingerprint before the first canonical write
- [x] stale-preview protection
- [x] serializable batched atomic merge executor (no per-message transaction loop)
- [x] changed-message version snapshot writes
- [x] same-source/parser execute idempotency and replay semantics
- [x] authoritative ChatGPT current-path replacement without unique-index swaps
- [x] preserve Claude no-current-leaf semantics
- [ ] multi-file import batch orchestration
- [ ] production execution/performance acceptance with the user's real ChatGPT and Claude exports

### PR D — web archive

- [x] Conversations navigation entry/page
- [x] import picker + preview + execute
- [x] conversation list/detail
- [x] message anchors
- [x] day statistics summary with explicit browser IANA timezone until Account owns a timezone
- [x] ChatGPT current-path / all-branch browse modes
- [x] Claude branch-inclusive disclosure when current leaf is unavailable
- [ ] production Web acceptance with real imported ChatGPT / Claude data

### PR E — dedicated search

- [x] message-level canonical substring search
- [x] provider/date/role/conversation filters
- [x] search saved branch messages rather than only ChatGPT current path
- [x] direct deep links to exact message
- [x] exact-message context window so deep links do not require paging from the start
- [x] automatic all-branch view when a ChatGPT search hit is outside current path
- [ ] production acceptance against imported real ChatGPT / Claude data

### PR F — pruning / exclusions

- [x] whole-window canonical delete + persistent provider/source exclusion
- [x] branch-root subtree delete + persistent source-node exclusion
- [x] later imports apply exclusion rules before merge planning
- [x] exclusion rules participate in Preview fingerprint / stale protection
- [x] raw import source remains preserved by ordinary Archive deletion
- [x] branch pruning repairs an authoritative current leaf when the removed subtree contained it
- [x] Web controls for window delete and branch delete
- [ ] production acceptance with imported real ChatGPT / Claude data
- [x] list exclusion rules and remove one rule without claiming immediate canonical restore
- [x] removing a rule makes matching content eligible on the next import; old Preview fingerprints become stale automatically
- [x] preserved-source restore UI from Import history uses re-Preview + explicit confirm Execute; no direct one-click canonical write
- [ ] optional UI-only Hide action
- [ ] dangerous raw-source purge / privacy erase flow

### PR G — favorites

- [x] single-message and contiguous visible-range favorites
- [x] title / note / tags with partial metadata updates
- [x] immutable per-message snapshots including visible state + content blocks + attachment metadata
- [x] retain canonical conversation/message refs without foreign-key cascade, so favorites survive later pruning
- [x] provider / conversation / tag list filters
- [x] Favorites-only filter for dedicated Conversation message search
- [x] CRUD Web API
- [x] production migration / backend rollout (`0043_conversation_favorites` is already below production head `0044`)
- [x] Web favorite selection and Favorites browse UI: single message / contiguous range, snapshot browse, metadata edit, delete

### PR H — Global Search

- [x] add Conversation as an explicit opt-in seventh module while preserving the existing six-module default
- [x] return canonical message snippet + conversation/message deep-link metadata
- [x] prevent Conversation volume from changing existing default search results by keeping it opt-in

### PR I — Claude — pulled forward after the real export arrived

- [x] inspect the user's real Claude export
- [x] implement Claude adapter
- [x] add privacy-safe fixtures derived from the real shape
- [x] preserve branching without inventing a current leaf
- [ ] verify repeated incremental Claude import through the production import pipeline

### PR J — multi-file import

- [x] orchestrate multiple archived source/run pairs without changing the lossless single-file upload path
- [x] deduplicate identical raw source + parser inputs inside one batch
- [x] plan files cumulatively in selection order so later exports see earlier batch changes
- [x] aggregate per-file create / update / unchanged / stale Preview summaries
- [x] bind Execute to a whole-batch fingerprint and revalidate every pending source before canonical writes
- [x] apply the validated batch in one serializable transaction with exact-request replay safety
- [x] expose backend batch Preview / Execute APIs
- [x] Web multi-select upload / batch review UI; single-file flow unchanged, 2–20 files use ordered batch Preview + explicit atomic Execute
- [ ] production acceptance with at least two real Claude export files

### PR K — Import history / source management

- [x] list immutable Conversation import sources with provider / original filename / SHA-256 / raw bytes / received time
- [x] report actual raw-source retention metadata, including stored encoding / bytes for PostgreSQL-backed sources
- [x] summarize processing / executed / failed / superseded runs per source
- [x] expose latest run in list view and full ordered run history in source detail
- [x] keep the history surface read-only; no raw-source purge or canonical mutation
- [x] expose authenticated Web API source list / detail endpoints
- [x] Web history / source-management UI with source metadata, run expansion, and raw-retention state
- [ ] production readback against real archived import sources

### PR L — preserved-source reapply

- [x] add explicit execution keys so ordinary imports remain idempotent while user-requested reapply is distinguishable
- [x] migrate executed-run uniqueness to source + parser + preview fingerprint + execution key
- [x] re-preview an existing immutable raw source without re-uploading bytes
- [x] force explicit reapply Preview to create a fresh processing run even if an older standard execution has the same fingerprint
- [x] keep Execute atomic and Preview-bound; reapply never writes canonical data before explicit Execute
- [x] preserve write-free replay of the same reapply run
- [x] expose authenticated preserved-source re-preview API
- [x] wire preserved-source restore UI as re-Preview → explicit confirm Execute (no unconfirmed canonical write)
- [ ] production acceptance after 0044 migration

## Acceptance invariants

- importing the same source twice never duplicates a conversation/message;
- a later export can add and update but cannot implicitly delete old archive data;
- changed messages retain the previous canonical version;
- branch nodes survive even when they are not on the current visible path;
- normal daily counts exclude thoughts/reasoning/tool-only nodes;
- model is never guessed;
- unknown provider fields/types are preserved or warned, never silently flattened away;
- one provider parser cannot depend on another provider's raw schema;
- a user-deleted conversation or branch remains excluded from later imports unless its exclusion rule is explicitly removed; removing the rule alone does not silently restore canonical data, it only makes the content eligible on a later import;
- ordinary Archive pruning never deletes the immutable raw import source;
- a favorite snapshot survives later canonical conversation/message pruning and keeps its captured text/content-block/attachment metadata;
- exclusion-rule changes after Preview make Execute stale before canonical writes;
- Claude production support is not claimed until verified against the user's real export.
