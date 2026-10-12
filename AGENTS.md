# LeileiOS agent workflow

## Quick Start

1. Read [.agent/domain-map.json](.agent/domain-map.json): paths, gates, runtime boundaries, refresh/acceptance requirements and conflict hotspots.
2. Fetch `origin/main` explicitly before starting a branch. Run `pnpm agent:status` (or `--json`). Status never fetches or modifies Git.
3. Run `pnpm agent:verify --plan`; use `--run` to execute the deduplicated local gates. Plans include committed diff from merge-base, staged/unstaged edits and untracked files. `--base <ref>` changes the comparison base. Review unmapped paths and shared hotspots manually; a plan is a starting scope, not proof of acceptance.
4. Write a failing targeted test, then implement and record RED → GREEN. Report tests actually run and baseline delta. Existing historical CI failures are a separate task; do not fix them incidentally.

## Runtime boundaries

- **Railway:** Node 22 server/MCP/writers. Merge != production live: verify deployed SHA, readiness and the changed authenticated contract.
- **Mac:** Native Live daemon/Claude SDK execute locally. Merged daemon/bridge code needs local fresh. `pnpm runtime:native-live-mac-daemon:fresh` requires canonical `~/Developer/leilei-os-main` on `main`, and fast-forwards only. Both fresh modes allow dirty `ios/**` files and preserve them; any dirty path outside `ios/**` blocks restart. If upstream touches the same dirty iOS file, Git safely refuses the merge. `...:fresh-current` explicitly runs the current feature branch without fetch/rebase. Neither autostashes, resets or discards edits.
- **iPhone:** sync intended iOS code before the next Xcode Run; preserve local signing settings. Device rebuild/acceptance is separate from server deployment.
- **Web:** Node **24**, as declared in `web/package.json`; use `npm ci` and Web typecheck/build there. Root `.node-version` is **22** for server/Mac tooling, not a Web override. CI currently uses Node 24; Claude bridge supports >=20. Do not upgrade server Docker incidentally.
- **Postgres:** schema/migrations and bytes/metadata live independently of devices. Production DB mutation, migrations, deployment/config changes and messages to external systems require explicit user authorization. Local gates never run production acceptance or `db:migrate`. Use an isolated local DB for integration tests.

## Workspace and closeout

The owner's Mac has **exactly one long-lived LeileiOS checkout**:
`~/Developer/leilei-os-main`. Use Git branches in that checkout for ordinary work.
There is no permanent UI/feature clone, including `leilei-os-ui`,
`leilei-os-ios-elevenlabs` or `leilei-os-ios-thinking`.

When isolation is essential, create a **disposable** worktree under
`${TMPDIR:-/tmp}` only; remove it at task closeout. Do not create another
persistent clone/worktree under `~/Developer`, `~/Documents`, Desktop, iCloud
Drive, Dropbox, OneDrive or another sync-provider folder. Do not move the live
Mac daemon's working directory under it or remove a worktree in use by a running
process. Keep the canonical checkout on `main` when using the supported
`runtime:native-live-mac-daemon:fresh` command.

Existing extra LeileiOS folders are **retirement candidates, not disposable
artifacts by name**. Before retiring one, inspect Git status, untracked/ignored
files, local-only commits/branches, Xcode signing, opened projects, running
processes, and any runtime configuration; preserve intended work in Git or an
explicitly approved patch/bundle. Do not automatically delete, move, reset or
overwrite those folders. Obtain owner approval for any uncertain data.

Before closeout: commit/push work that must survive; run
`pnpm hygiene:finish` and `git status --short --branch`; remove only
**task-created** temporary worktrees and known disposable dependency/build/cache
artifacts; run `git worktree prune`. Report residue that cannot safely be
removed. Dependencies in the one canonical checkout may stay. Never remove
tracked files, `.env`, DBs, keys, backups, runtime/user data or
uncertain-provenance files as cleanup. No ad hoc backup clones.

Open a PR with scope, verification and refresh/acceptance evidence; do not merge unless requested.
