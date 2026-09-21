# Native / Live Conversation Core Design

## Status

Proposed. This document defines the persistence boundary for native LeileiOS ↔ Claude Code conversations. It does not introduce an API, invoke Claude Code, or alter any UI.

## Goal

Make the existing conversation storage canonical for both imported archives and native/live conversations without creating a second `live_*` conversation, message, or content-block table family.

The canonical identity is the LeileiOS conversation UUID. A Claude Code provider session ID is runtime state only and must never identify a conversation.

## Existing State

The existing physical tables are reusable but import-shaped:

- `conversations` has import provenance (`provider`, `source_conversation_id`, fingerprints, and import-run references) as required fields.
- `conversation_messages` likewise requires import node IDs, fingerprints, and import-run references.
- `conversation_content_blocks` is already the sole block table, but has import-oriented `kind` / `raw_type` fields and no creation timestamp.
- There is no persisted provider-session checkpoint table.
- `src/domains/live-conversation/live-conversation.ts` contains an in-memory prototype of immutable messages, branches, and Claude checkpoints. It establishes desired behavior but is not a database implementation.

Existing archive/import tables, migrations, readers, parsers, lifecycle management, favorites, pruning, and routes remain in place. This work isolates their scope; it does not delete or rewrite their historical data.

## Selected Approach

Extend the existing canonical tables and introduce one new runtime table:

1. `conversations` becomes the sole canonical conversation table.
2. `conversation_messages` becomes the sole canonical message table.
3. `conversation_content_blocks` remains the sole canonical block table.
4. `conversation_provider_session_checkpoints` is added because no existing table represents provider checkpoint state.
5. A persisted origin discriminator isolates imported archive rows from native/live rows.

Rejected alternatives:

- A `live_conversations` / `live_messages` / `live_content_blocks` family would duplicate canonical concepts and require two readers, writers, and migrations.
- Replacing or renaming the archive tables would unnecessarily break existing import/archive functionality and violates the requirement to retain legacy imports during this phase.

## Canonical Data Model

### Conversation (`conversations`)

Native canonical fields:

| Field | Meaning |
| --- | --- |
| `id` | Permanent LeileiOS canonical conversation UUID. |
| `user_id` | Owner and tenant scope. |
| `title` | Optional conversation title. |
| `lifecycle_status` | Canonical lifecycle state. Initially `active`, `archived`, or `deleted`. |
| `current_head_message_id` | Current canonical branch head; nullable for an empty conversation. |
| `created_at`, `updated_at` | Canonical timestamps. |

Isolation field:

| Field | Meaning |
| --- | --- |
| `origin` | `legacy_import` or `native_live`. Existing rows backfill to `legacy_import`; new native rows use `native_live`. |

The existing archive-provenance columns remain for legacy rows. Their current non-null constraints become conditional: they are required only when `origin = 'legacy_import'` and null for `origin = 'native_live'`. Existing import providers remain `chatgpt` and `claude`; native rows do not use a conversation-level provider identity.

`current_head_message_id` has a composite integrity constraint to reference a message belonging to the same conversation and user. The writer also verifies this ownership within its transaction.

Existing `archived_at` / `deleted_at` remain temporarily for legacy compatibility. The native writer uses `lifecycle_status`; no existing archive route is repurposed in this phase.

### Message (`conversation_messages`)

Native canonical fields:

| Field | Meaning |
| --- | --- |
| `id` | Immutable canonical message UUID. |
| `user_id`, `conversation_id` | Tenant and conversation ownership. |
| `parent_message_id` | Nullable canonical parent UUID. |
| `role` | `user` or `assistant` for native/live messages. |
| `status` | `pending`, `streaming`, `completed`, or `error`. |
| `created_at` | Creation time. |
| `completed_at` | Nullable completion time. |

Existing import source-node, source-message, fingerprint, path, model, and import-run columns remain for legacy rows. Their import-only required constraints become conditional on `conversations.origin = 'legacy_import'` at the writer/service boundary; because PostgreSQL checks cannot reference the parent row, migration-level nullability is relaxed and native/legacy validity is enforced by separately scoped writers and regression tests.

The native writer never updates message text or parentage. It writes new rows only. Content belongs to ordered blocks rather than a mutable message text column.

### Content Block (`conversation_content_blocks`)

The existing table remains the only content-block table. It gains:

| Field | Meaning |
| --- | --- |
| `created_at` | Immutable block creation timestamp. |

Its canonical native `kind` values are `text`, `tool_use`, `tool_result`, and `attachment`. Legacy values remain legal so imported history stays valid. `payload` remains structured JSON. For native rows, `raw_type` is a transport/debug classification and does not become a second canonical content contract.

`(message_id, ordinal)` remains unique. Ordinals are append-only and non-negative.

### Provider Session Checkpoint (`conversation_provider_session_checkpoints`)

New table:

| Field | Meaning |
| --- | --- |
| `id` | Checkpoint UUID. |
| `user_id` | Tenant scope. |
| `conversation_id` | Canonical conversation. |
| `canonical_message_id` | The completed canonical assistant message represented by the checkpoint. |
| `provider` | Initially only `claude_code`. |
| `provider_session_id` | Claude Code session ID for resume/fork. |
| `provider_checkpoint_id` | Optional provider-native checkpoint identifier. |
| `created_at` | Binding creation time. |

The table has a composite FK to the same-user conversation and a composite FK that ensures the canonical message belongs to that conversation and user. It has a uniqueness constraint for `(conversation_id, canonical_message_id, provider)` and indexes for user-scoped head lookup. It stores no transcript and no Claude JSONL path.

## Canonical Semantics

### Immutable graph

Messages form a directed tree through `parent_message_id`:

- A first user message has no parent.
- A standard assistant reply has the user message as parent.
- A retry creates a new assistant child of the same user message; it never overwrites the prior assistant.
- An edit creates a new user child of the edited message's parent, then creates a new assistant child of that replacement user message.
- Existing messages, content blocks, parents, and text are never changed in place.

`conversations.current_head_message_id` chooses one head of this immutable graph as the current canonical path. Switching the current path changes only that field; it neither deletes nor mutates previous branches.

### Runtime isolation

Native runtime lookup is branch-aware by canonical head:

```
conversation_id + canonical_message_id -> provider session checkpoint
```

It is explicitly not:

```
conversation_id -> one mutable provider session ID
```

The provider checkpoint is for Claude Code recovery/fork only. The canonical conversation remains the message/block graph in PostgreSQL. Claude Code JSONL is neither read nor treated as canonical history.

## Writer / Service Boundary

Add a database-backed `NativeLiveConversationRepository` plus a thin `NativeLiveConversationService`, separate from archive import/read services.

The repository may expose fine-grained persistence primitives internally:

- `createConversation`
- `getConversation`
- `appendUserMessage`
- `appendAssistantMessage`
- `appendContentBlock`
- `setCurrentHead`
- `bindProviderCheckpoint`
- `getProviderCheckpointForHead`

The service must not expose a sequence that lets callers assemble a partially completed assistant turn. The only successful assistant-completion entry point is:

- `completeAssistantTurn(...)`

That operation atomically writes the assistant message, all content blocks, the exact provider checkpoint, and `current_head_message_id`.

Every operation accepts `userId`; all reads and writes include user scope. A row owned by a different user is indistinguishable from not found to callers.

The writer does not expose Retry/Edit HTTP endpoints in this phase. Its graph model supports those future operations without making them public.

## Transaction Rules

1. **Create conversation** inserts a native-origin conversation with a null head.
2. **Append user message** inserts only the immutable user row and its blocks. It does not fabricate an assistant or checkpoint.
3. **Complete assistant turn** is one database transaction: insert assistant message and blocks, bind its provider checkpoint, then set the conversation head to that assistant message. If any step fails, none of those assistant/head/checkpoint changes commit.
4. **Runtime failure** leaves the already-created user message visible. No assistant message or checkpoint is fabricated.
5. **Set current head** verifies that the target message belongs to the specified native conversation and user before changing the head.
6. **Checkpoint binding** verifies that the target canonical message belongs to the specified conversation and user; it is bound to that exact message, never merely the conversation.

A checkpoint binding means the provider state is exact for that canonical assistant message. A provider session ID that has continued to grow after the message is not, by itself, an immutable historical checkpoint and must not be bound as though it were one.

If Claude Code exposes a message-level provider checkpoint identifier, that exact identifier may be persisted. If it does not, the runtime must preserve an exact frozen/forked provider session for that head or reconstruct provider context from canonical LeileiOS history before branching from the old head.

This makes a failed model call recoverable and observable while preserving canonical history.

## Legacy Isolation

- Existing import writers write only `origin = 'legacy_import'` rows and continue supplying import provenance.
- Existing archive readers, lifecycle routes, favorites, pruning, and exclusions remain import-oriented and explicitly filter to legacy-origin conversations where relevant.
- Native writer/service only reads and writes `origin = 'native_live'` rows.
- No legacy table, existing migration, import source, raw blob, or historical parser is removed.
- No existing Web or iOS UI route is changed in this phase.

## Migration Shape

One additive/constraint-relaxing migration will:

1. Add `origin`, backfill all existing conversations as `legacy_import`, and make it non-null with allowed values.
2. Add native conversation fields and indexes.
3. Relax import-only null constraints on reused conversation/message columns while retaining legacy records and existing FKs for populated values.
4. Add native message fields and the self-parent FK scoped by user/conversation.
5. Add `created_at` and native attachment kind support to `conversation_content_blocks`.
6. Create `conversation_provider_session_checkpoints` with tenant-scoped composite foreign keys and uniqueness/indexes.
7. Add a composite FK from a conversation's current head to a message in that same conversation/user.

The migration will not rewrite imported content, infer native state from import data, create fake checkpoints, or delete any legacy data.

## Tests

Add database/service tests for:

1. Native conversation creation.
2. User → assistant append with parent chain.
3. Sibling assistant branches under one user message.
4. Current head switching without mutation of prior messages.
5. A provider checkpoint bound to its exact assistant message.
6. Independent provider checkpoints for multiple canonical heads in one conversation.
7. Cross-user reads and writes returning not found / denied without leakage.
8. Transactional assistant completion: a failure leaves user content but no fabricated assistant, head, or checkpoint.
9. Regression coverage that legacy import fixtures remain readable under `legacy_import` isolation.

## Out of Scope

- Claude CLI invocation, Claude Code hooks, or transport integration.
- Retry/Edit HTTP routes.
- Web and iOS UI changes.
- Chat history JSONL storage.
- Import cleanup, table deletion, or historical backfill beyond the explicit origin discriminator.
- Railway rollout or production data migration execution.

## Acceptance Criteria

After implementation:

- There is one canonical physical table family for conversations, messages, and blocks.
- Native conversations can persist immutable parent/child message graphs and switch canonical heads.
- Provider session IDs are bound only to exact canonical message checkpoints.
- Legacy import/archive behavior remains isolated and regression-tested.
- Every persisted operation is user-scoped and transactionally safe.
