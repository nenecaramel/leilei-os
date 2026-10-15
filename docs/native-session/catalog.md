# Native session switching: current operator guide

> New continuation-only implementation: see [continuation mode](continuation.md).
> The acceptance record and full-history workflow below describe the older path;
> they do not constitute live acceptance of continuation mode.

As of the controlled **2026-10-11** acceptance, one **manual, linear** Desktop → LeileiOS → Desktop → LeileiOS round trip succeeded with the **same native session**. This is not acceptance for arbitrary branches, old imported-message Edit/Retry/Fork, concurrent clients, or every Desktop/SDK version. The **automatic Desktop launcher failed** and is not the accepted route.

For the original stage 1/2/3 investigations, source-projection invariants, offline fixtures, migration/attachment proofs and detailed acceptance history, use the [immutable engineering record](https://github.com/nenecaramel/leilei-os/blob/0cd06cbb81d5a29f03f1bf36f476280dc5abb3b7/docs/native-session/catalog.md). Historical `not enabled` / `pending` notes there describe their stages, not necessarily current state.

## Accepted manual commands

Use Node 22 and authenticated Railway CLI on the owner's Mac, from the intended current checkout:

```sh
/opt/homebrew/opt/node@22/bin/node scripts/native-session-local.mjs list
/opt/homebrew/opt/node@22/bin/node scripts/native-session-local.mjs desktop SESSION_ID
/opt/homebrew/opt/node@22/bin/node scripts/native-session-local.mjs leileios SESSION_ID
```

`list` reads catalog data without obtaining relay credentials. For the two state-changing commands, the wrapper retrieves only the required relay credentials from the configured Railway project/environment/service **into process memory**. It must not print or persist credentials, change deployments, run migrations, restart the Mac daemon, or send a Claude prompt.

**LeileiOS → Desktop**

1. Wait until the LeileiOS turn has fully finished; resolve any busy or recovery state using the existing supported flow.
2. Run `desktop SESSION_ID` and require its successful history sync, canonical checkpoint and ownership-release checks.
3. **Manually** open the same session in the official Claude Desktop app. This command deliberately does not start Claude.

**Desktop → LeileiOS**

1. Wait until Desktop generation has finished and **exit that conversation** in Desktop.
2. Run `leileios SESSION_ID`, which checks/reconciles the source and restores the current history/ownership.
3. Refresh or reopen the existing LeileiOS conversation before sending.

Never send concurrently from both clients, treat an open-but-idle Desktop session as released, or edit JSONL/recovery receipts to bypass a failure.

## Safety and limitations

- A stale Desktop index may advance only along **completed descendants of the same native session**. Detached/unfinished tails and guessed branch heads are refused; the native session ID stays stable, while execution checkpoints can differ from display checkpoint UUIDs.
- Pending local terminal results, SessionStore append receipts, unresolved backend turns and pending compacts block switching. Recover them through the existing runtime rather than dropping records. An automatic launcher failure does not guarantee that ownership can be rolled back.
- The sync preserves native source records, canonical message IDs and head/checkpoint lineage. Embedded base64 image/document content may be materialized using the authenticated owned-attachment path with byte/hash verification; external URLs, missing source bytes and local-only paths are **reported unavailable**, not silently fetched or fabricated.
- Even correct sync does not grant an atomic lease honored by official Desktop. One-client-at-a-time is still a human operating requirement. Real iPhone image/file preview and non-linear editing need separate acceptance.

## Low-level diagnostics, not the accepted launcher

The repository also has `tools/claude-bridge/scripts/native-session-switch.mjs` with `--list`, `--check`, `--restore` and `--desktop` options. Those require explicit private relay configuration for restore/handoff; `--desktop` may invoke the official launcher and **is not** the accepted manual workflow above. See the linked stage record before operating it directly. Do not copy tokens into commands, logs or documentation.

Relevant tests include `tests/native-session-history-repository.integration.test.ts` and the Claude bridge native-session switch/preflight tests. Offline tests and a single controlled live round trip do not establish universal compatibility. Treat deployment, local runtime refresh and additional live model sessions as separate authorized actions.
