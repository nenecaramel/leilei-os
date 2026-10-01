# LeileiOS agent workflow

## Quick Start

1. Read [.agent/domain-map.json](.agent/domain-map.json): paths, gates, runtime boundaries, refresh/acceptance requirements and conflict hotspots.
2. Fetch `origin/main` explicitly before starting a branch. Run `pnpm agent:status` (or `--json`). Status never fetches or modifies Git.
3. Run `pnpm agent:verify --plan`; use `--run` to execute the deduplicated local gates. Plans include committed diff from merge-base, staged/unstaged edits and untracked files. `--base <ref>` changes the comparison base. Review unmapped paths and shared hotspots manually; a plan is a starting scope, not proof of acceptance.
4. Write a failing targeted test, then implement and record RED → GREEN. Report tests actually run and baseline delta. Existing historical CI failures are a separate task; do not fix them incidentally.

## Runtime boundaries

- **Railway:** Node 22 server/MCP/writers. Merge != production live: verify deployed SHA, readiness and the changed authenticated contract.
- **Mac:** Native Live daemon/Claude SDK execute locally. Merged daemon/bridge code needs local fresh. `pnpm runtime:native-live-mac-daemon:fresh` requires clean canonical `~/Developer/leilei-os-main` on `main`, and fast-forwards only. `...:fresh-current` explicitly runs a clean current feature branch without fetch/rebase. Neither autostashes, resets or discards edits.
- **iPhone:** sync intended iOS code before the next Xcode Run; preserve local signing settings. Device rebuild/acceptance is separate from server deployment.
- **Web:** Node **24**, as declared in `web/package.json`; use `npm ci` and Web typecheck/build there. Root `.node-version` is **22** for server/Mac tooling, not a Web override. CI currently uses Node 24; Claude bridge supports >=20. Do not upgrade server Docker incidentally.
- **Postgres:** schema/migrations and bytes/metadata live independently of devices. Production DB mutation, migrations, deployment/config changes and messages to external systems require explicit user authorization. Local gates never run production acceptance or `db:migrate`. Use an isolated local DB for integration tests.

## Workspace and closeout

Only long-lived copies: `~/Developer/leilei-os-main` and `~/Developer/leilei-os-ui`. No persistent clones/worktrees/builds under Documents, Desktop, iCloud or other sync-provider folders; no third persistent clone. Use disposable worktrees under `${TMPDIR:-/tmp}` when isolation is needed, and preserve the owner's unrelated edits.

Before closeout: commit/push work that must survive; run `pnpm hygiene:finish` and `git status --short --branch`; remove task-created temporary worktrees, dependency/build/cache artifacts and files; run `git worktree prune`. Report any residue that cannot safely be removed. Dependencies in the two canonical clones may stay. Never remove tracked files, `.env`, DBs, keys, backups, runtime/user data or uncertain-provenance files as cleanup; use the repository hygiene script for known disposable residue. No ad hoc backup clones: preserve work in Git or an explicitly requested patch/bundle.

Open a PR with scope, verification and refresh/acceptance evidence; do not merge unless requested.
