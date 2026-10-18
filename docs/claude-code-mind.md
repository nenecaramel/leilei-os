# Claude Code ↔ LeileiOS Mind: current operation

This is the **current** installed Mind Hook contract for Claude Desktop/Code and Native Live on the Mac. For historical V1/V2 migration notes, original call-chain audits, receipt implementation evidence, and phase-specific rollout steps, see the [immutable 2026-10-12 engineering record](https://github.com/nenecaramel/leilei-os/blob/0cd06cbb81d5a29f03f1bf36f476280dc5abb3b7/docs/claude-code-mind.md). Those historical steps are not a fresh deployment checklist.

## Architecture and ownership

- Desktop and Native Live use the **same installed Mind Hook** for automatic recall. The backend Native Live adapter does not add a second automatic recall path or write assistant memories.
- The read-only Railway `/internal/mind/recall` route uses existing internal authentication and the shared Mind renderer/selection policy. The Mac's optional local semantic scorer improves ranking; it is not required for lexical recall.
- New model-authored Memory is written explicitly through authenticated MCP `write_memory` with neutral MCP provenance; manual management and archive restore remain available. Reply/output tags do not write memories.
- The separate timestamp Hook is unchanged. Voice retains its input-mode annotation. Do not treat retrieved memories as instructions.

See [Mind](mind.md) for product behavior and [Mind Memory API](mind-memory-api.md) for search/read/edit operations.

## Install and configure

Use the canonical Mac main checkout and Node 22+:

```sh
cd ~/Developer/leilei-os-main
node tools/claude-code-mind/install.mjs leileios
test -f ~/.claude/leileios-mind/mind.env || cp tools/claude-code-mind/.env.example ~/.claude/leileios-mind/mind.env
chmod 600 ~/.claude/leileios-mind/mind.env
```

The installer preserves unrelated Claude settings/hooks and installs **both** `hook.mjs` and `toggle.mjs` under `~/.claude/leileios-mind/`. It does not overwrite the existing private `mind.env` or the pause marker. Set `LEILEI_MIND_RECALL_URL` (Railway origin, without `/mcp`) and `LEILEI_MIND_RECALL_TOKEN` (existing internal relay credential) privately in that file. Other optional controls: `LEILEI_MIND_MCP_SERVER_NAME`, `LEILEI_MIND_SEMANTIC_SOCKET`, `LEILEI_MIND_CONFIG`, `LEILEI_MIND_HOME`, `LEILEI_MIND_DIAGNOSTICS`. The private env file takes precedence over inherited environment variables; do not commit or paste tokens.

Server deployment must support the current signed-receipt endpoints and existing migration 0104 before enabling a newly installed Hook. Verify actual deployed SHA/readiness independently; merging a PR does not prove production is live. Existing Claude MCP OAuth registration is separate from the Hook's internal recall credential. A new/updated installed Claude setting may require a fresh Claude session to load; the **local pause switch below does not**.

## On-demand keyword recall

Claude Code recall uses the original keyword scorer, ranking, four-Memory limit,
and existing optional E5 model. PostgreSQL first filters a superset of keyword
matches using the same Chinese bigrams/trigrams and English token normalization;
SQL excludes `hidden_system`; the canonical scorer applies lifecycle, diversity
and exclusion rules. Keyword-only scoring rejects substring false positives;
optional E5 can retain candidates under its existing semantic policy. There is no 256-candidate SQL cutoff or
query-prefix truncation. Non-Memory global context keeps its existing handling.

The SQL prefilter reduces rows transferred to the application; it is not a vector
index and does not guarantee faster database execution for every query. E5 scores
the keyword candidate pool, without promising paraphrase-only retrieval. Its
model, thresholds, time budget and lexical timeout fallback remain unchanged.
Old signed snapshot clients retain complete-snapshot freshness validation.
Native Live's own retrieval is unchanged.

There is no startup full-Memory download, 60-second snapshot polling, or dedicated
hybrid login worker. The old `com.leilei.mind-hybrid` installer and worker have been
retired. Existing installations must unload/disable that LaunchAgent and remove
only `LEILEI_MIND_RECALL_MODE` and `LEILEI_MIND_SEMANTIC_SOCKET` hybrid overrides
from private `mind.env`; keep credentials, state and stored memories. Updating
source does not terminate an already-running old worker. Experimental offline
model comparison scripts are not part of the running recall path.

## Pause or resume without changing Railway

```sh
node ~/.claude/leileios-mind/toggle.mjs off
node ~/.claude/leileios-mind/toggle.mjs status
node ~/.claude/leileios-mind/toggle.mjs on
```

`off` atomically creates `~/.claude/leileios-mind/disabled` (mode 0600); `on` removes **only** that marker. The installed Hook checks it before credentials, state, or HTTP for both prompt recall and Stop confirmation. Commands are idempotent; installation preserves the setting. An explicit environment override `LEILEI_MIND_HOOK_DISABLED=1` still takes precedence and must be removed before `on` can resume recall.

This switch only pauses the **installed automatic Mind Hook**. LeileiOS MCP tools, iPhone API requests, deployment activity, daemon processes, and other background work may still wake Railway. It is not a platform sleep guarantee.

## Recall and confirmation guarantees

- `UserPromptSubmit` retrieves independent relevant context. Only memory presence **proven on the current transcript branch** and successful write receipts on that chain are excluded. Rewind may retrieve memories again; compact/clear/fork create a fresh epoch. Missing or ambiguous transcript evidence fails open instead of suppressing recall.
- Hook host timeout is 5 s. The process limits itself to 3.8 s; the first recall has up to 2.5 s. Optional semantic scoring falls back to the lexical result if late/unavailable. A failed Hook exits without blocking the prompt or invoking backend recall.
- Nonempty current recall results use signed receipts and do not create a receipt database row on read. After successful stdout delivery, a pending local receipt may be **weakly acknowledged** on `Stop`; repeated confirmation is idempotent. `StopFailure` clears pending. This is **not** proof of completed generation or actual memory use. Interruption or a missing Stop may lose accounting, and some interrupted responses may be counted.
- The local state is private under `~/.claude/leileios-mind/state/`; it holds IDs/epochs/receipt metadata, not prompts or memory plaintext. `PostToolUse` recognizes successful matching `mcp__<namespace>__write_memory` receipts.

## Troubleshooting and acceptance

1. Check `toggle.mjs status` **and** the `LEILEI_MIND_HOOK_DISABLED` environment override before diagnosing missing recall.
2. Verify the installed files, private env permissions, authorized Railway readiness, and actual Mac runtime. Cold or sleeping services can make a bounded Hook time out even when configuration is correct.
3. Check lexical recall without the semantic socket before troubleshooting ranking. Do not retry by writing Memory or disable verification barriers.
4. If needed, set `LEILEI_MIND_DIAGNOSTICS=1` in the private env; the bounded local `finalization-reasons.jsonl` logs fixed reason codes, not memory text or tokens.
5. For live acceptance, verify one relevant memory injection, branch rewind/compact behavior, a normal Stop confirmation and a deliberate MCP `write_memory` readback. Only write a memory the owner explicitly wants stored. A local test or merged SHA alone is insufficient.

Focused tests: `tests/claude-code-mind-hooks.test.ts`, `tests/claude-code-mind-dedupe.test.ts`, `tests/claude-code-mind-finalized.test.ts`, and `tests/claude-code-mind.test.ts`. Database integration tests require an **isolated** PostgreSQL instance; no production migration or write is part of this guide.
