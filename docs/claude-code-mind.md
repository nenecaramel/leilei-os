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

## Background hybrid scoring without keeping a terminal open

The original Claude Code/Desktop automatic recall works without Native Live: the installed Hook calls authenticated Railway directly. With optional `hybrid_conditional_v1`, each user prompt makes one Railway request for a signed lexical result plus at most 256 eligible candidates; the local E5+ritrieve worker scores only those candidates, and one more Railway request verifies its selected 0–2 IDs against the current snapshot. Both paths are capped at 2 memories *on the Claude Code server adapter only*. If scoring is late/unavailable, retain the signed lexical result; if the snapshot changed, use the newly validated Railway lexical response, never stale local scores.

On the canonical Mac checkout, after updating `main`, configure a separate user-login LaunchAgent once:

```sh
cd ~/Developer/leilei-os-main
node scripts/install-mind-hybrid-background.mjs
```

This installs `com.leilei.mind-hybrid` with `RunAtLoad` and `KeepAlive`, installs the current Hook, and sets the private mode/socket paths. It chooses a working Node 22 binary, reads existing private `mind.env` credentials, and creates only `~/.leileios/claude-code-mind/hybrid.sock`. It does **not** start the Native Live/Wake daemon, modify real memories or Railway, or touch the older `semantic.sock`. Model warmup can take time after login; requests during startup use the Railway-only fallback. The standalone scorer does not synchronize Memory, download a full snapshot, or contact Railway when idle. Its dedicated Claude Code socket handler is isolated from the existing Native Live Mac semantic server. The LaunchAgent's log files are private under `~/.leileios/mind-hybrid-background/`.

Check with `launchctl print gui/$(id -u)/com.leilei.mind-hybrid`. Its private `POST /score-hybrid` socket accepts only one query and a bounded candidate list; it returns at most 2 IDs. The standalone worker does not own a snapshot and has no 60-second Railway polling.

To restore the original desktop-only configuration, remove `LEILEI_MIND_RECALL_MODE` and `LEILEI_MIND_SEMANTIC_SOCKET` from `mind.env`, then `launchctl bootout gui/$(id -u)/com.leilei.mind-hybrid` and remove **only** `~/Library/LaunchAgents/com.leilei.mind-hybrid.plist`. The real Mind database and Railway are unaffected.

## PostgreSQL candidate index (Claude Code only)

Migration `0110_claude_code_recall_trgm_index.sql` adds PostgreSQL-maintained
trigram, plain-text FTS and scope/recency indexes on existing Memory rows.
The original global Hook sends no requests when idle; Railway now selects
at most 256 eligible candidates using indexed fuzzy/Chinese literal/English
full-text matches plus bounded historical coverage before the local two-model
reranker. All inserts, edits, visibility changes and deletions are handled by
the database indexes, without periodic Mac synchronization.

This stage does not introduce a pgvector semantic first-stage index.
Semantically related Memory with no overlapping words can still be missed by
PostgreSQL candidate selection; the E5/ritrieve reranker cannot recover an
absent candidate. Acceptance must measure both this recall limitation and
per-turn cold-model latency before changing production defaults.

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
- Hook host timeout is 5 s. The process limits itself to 3.8 s; the first recall has up to 2.5 s. Optional semantic scoring falls back to the lexical result if late/unavailable. This path sends 1–2 Railway requests only when a user prompt occurs, not at idle. A failed Hook exits without blocking the prompt or invoking backend recall.
- Nonempty current recall results use signed receipts and do not create a receipt database row on read. After successful stdout delivery, a pending local receipt may be **weakly acknowledged** on `Stop`; repeated confirmation is idempotent. `StopFailure` clears pending. This is **not** proof of completed generation or actual memory use. Interruption or a missing Stop may lose accounting, and some interrupted responses may be counted.
- The local state is private under `~/.claude/leileios-mind/state/`; it holds IDs/epochs/receipt metadata, not prompts or memory plaintext. `PostToolUse` recognizes successful matching `mcp__<namespace>__write_memory` receipts.

## Troubleshooting and acceptance

1. Check `toggle.mjs status` **and** the `LEILEI_MIND_HOOK_DISABLED` environment override before diagnosing missing recall.
2. Verify the installed files, private env permissions, authorized Railway readiness, and actual Mac runtime. Cold or sleeping services can make a bounded Hook time out even when configuration is correct.
3. Check lexical recall without the semantic socket before troubleshooting ranking. Do not retry by writing Memory or disable verification barriers.
4. If needed, set `LEILEI_MIND_DIAGNOSTICS=1` in the private env; the bounded local `finalization-reasons.jsonl` logs fixed reason codes, not memory text or tokens.
5. For live acceptance, verify one relevant memory injection, branch rewind/compact behavior, a normal Stop confirmation and a deliberate MCP `write_memory` readback. Only write a memory the owner explicitly wants stored. A local test or merged SHA alone is insufficient.

Focused tests: `tests/claude-code-mind-hooks.test.ts`, `tests/claude-code-mind-dedupe.test.ts`, `tests/claude-code-mind-finalized.test.ts`, and `tests/claude-code-mind.test.ts`. Database integration tests require an **isolated** PostgreSQL instance; no production migration or write is part of this guide.
