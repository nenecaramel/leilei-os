# LeileiOS coding-agent workspace policy

This policy applies to every coding agent working on LeileiOS, including ChatGPT and Codex.

## Long-lived local workspaces

On the owner's Mac, the only long-lived LeileiOS working copies are:

- `~/Developer/leilei-os-main` for mainline work.
- `~/Developer/leilei-os-ui` for the current UI integration branch.

Do not create persistent clones, worktrees, recovery copies, dependency stores, or build directories under `~/Documents`, iCloud Drive, Desktop, Dropbox, OneDrive, or another sync-provider location.

Do not create a third persistent LeileiOS clone just to isolate a task.

## Temporary task isolation

If a task truly needs an isolated checkout, create a temporary Git worktree outside sync-provider folders, preferably under `${TMPDIR:-/tmp}` or another disposable local path.

The task that creates a temporary worktree owns its cleanup. Before the task is considered finished:

1. Commit or push any work that must survive.
2. Verify there are no unique uncommitted changes that need preservation.
3. Remove the temporary worktree.
4. Run `git worktree prune`.
5. Remove task-local dependency/build/cache artifacts with the worktree.

Never preserve work by making an ad hoc backup clone. Use Git history, a branch/PR, or an explicitly requested patch/bundle instead.

## Generated files and caches

Generated output is disposable unless it is tracked by Git or explicitly documented as durable project data.

Before deleting something because its name looks generated, check whether Git tracks that exact file or any child path. A path named `build` or similar is not automatically disposable.

Safe cleanup targets include untracked instances of:

- `.DS_Store`
- `.pnpm-store`
- `.derivedData`
- `dist`
- `coverage`
- `.turbo`
- `.vite`
- `test-results`
- `playwright-report`
- `xcuserdata`
- `*.tsbuildinfo`

Dependencies in the two canonical active clones may remain when they are useful for ongoing work. Dependencies installed only for a temporary checkout must disappear when that checkout is removed.

Do not auto-delete or overwrite `.env`, databases, encrypted backups, patches, bundles, keys, certificates, runtime state, user data, or any file with uncertain provenance.

## Mandatory task closeout

Before reporting a coding task as complete on the owner's Mac:

1. Run `pnpm hygiene:finish` from the active repository.
2. Run `git status --short --branch`.
3. Confirm no task-created worktree, clone, cache directory, build output, user-data directory, or temporary file remains.
4. If cleanup cannot safely complete, report exactly what remains and why instead of silently leaving residue.

A task is not complete merely because its code is committed or merged; its temporary local footprint must also be closed out.
