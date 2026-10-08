# Mind Memory permanence baseline (2026-10-08)

This document records the agreed contract for new Mind Memory features (Dayspace, search, detail and editing).

## Non-negotiable baseline

- `runtime_subject_states` is the canonical Memory source; no parallel Memory tables or copies of daily papers.
- Memory content is retained until a **user-requested deletion** or a higher-priority security/privacy operation. Time-based archival, semantic scrubbing, forgetting and physical purge are disabled.
- The lifecycle may continue to decay **numeric salience** and use `active`/`fading` for ranking; a low score must never irreversibly eliminate a Memory from retrieval eligibility.
- Existing `archived` records with content are eligible for recall, and maintenance converts their lifecycle state back to `fading` or `active`, retaining IDs, content, provenance and timestamps. Previously scrubbed `forgotten` tombstones cannot be reconstructed without a backup; do not claim otherwise.
- Keep status/authority/scope security filtering. User visibility in Mind/Dayspace is not equivalent to global Claude Code auto-injection.
- Claude Code PR #959 Hook behavior remains unchanged: per-prompt auto-recall, rewind-safe repeated lookup, session/epoch/pending fences and weak Stop signed-receipt confirmation. Confirm is not a proof of model usage.

## Next-stage Memory features

- Date-group by the **canonical** `occurredAt` in `Asia/Shanghai`; nullable date is a separate undated bucket, never silently `createdAt`.
- Search and read by date via shared backend service, database filters and bounded cursor pagination; regular reading must not mutate lifecycle/recall accounting.
- Single `update_memory` implementation shared by Mind detail and Dayspace; preserve ID, scope, provenance, authority and lifecycle fields. Preserve the semantics of `temporal_v1` (user-supplied time vs source-message time).
- Updates must merge from the **current locked row**. Stop-confirm simultaneously modifies lifecycle payload and `updatedAt`; guard against lost updates and spurious content version conflicts.
- Post-edit contents must be visible to MCP search immediately and to Hook recall when existing scope and `written_ids` exclusions permit. Do not change Hook as part of UI/search work.
- Textual memory data is untrusted input for models. Escape/label it as data; do not let tool outputs or memory text supply instructions.
- Do not add vectors, auto-merging, an audit/history table, a second Memory store, or a duplicate daily-paper persistence table for this release.

## Validation boundaries

- No destructive SQL migration is required for this baseline; evaluate existing historical content read-only before planning any restoration.
- Test below-threshold decay, archived-content retrieval, disabled manual archive, no forgetting/scrubbing/purge calls, and preservation of original text under maintenance.
- Validate concurrent edit versus Stop-confirm, date movement between paper views, no-date records, user and scope boundaries, MCP paging and rewind with the new UI separately.
- Production deployment and test results must be reported separately from code changes; until validated, a PR is not a deployed guarantee.
