# Branch and release policy

## Canonical trunk

`main` is the only formal integration and release trunk.

- GitHub default branch: `main`.
- Railway Production source: `main`.
- Vercel Production Branch: `main`.
- Feature, maintenance, experiment, and agent-created branches are short-lived work branches.
- Work enters `main` through a reviewed pull request unless an explicitly documented emergency procedure applies.

## Integration rules

1. Branch from the latest `main` and keep the work focused on one change.
2. Avoid direct pushes, force-pushes, reset/rebase rewrites of shared work, and merge commits made outside the reviewed pull-request flow.
3. A pull request must document scope, migration impact, production impact, and the verification gates that actually ran.
4. Draft pull requests are review work, not release evidence.
5. Merge acceptance and production acceptance are separate records: a merged SHA is not considered live until the deployment platform reports that SHA and the required production checks pass.

## Release flow

1. Start from the latest `main`.
2. Run the applicable root/Web tests, typechecks, builds, and database gates; record skipped gates and their reasons.
3. Open a reviewed pull request back to `main` with scope, migration impact, production impact, and verification evidence.
4. Merge only after review and release ownership are clear.
5. Let the configured platform release path consume `main`, or trigger the approved deployment procedure when automatic deployment is unavailable.
6. Record the deployed SHA and production verification result after the platform reports success.

## Branch cleanup

Merged branches should be deleted once their commits are reachable from `main` and no active worktree or release process depends on them.

A branch must be retained when it contains commits not reachable from `main` until those commits are explicitly triaged as one of:

- active work to finish through a pull request;
- historical work worth preserving;
- superseded/abandoned work that an owner has explicitly approved for deletion.

Do not use “no open pull request” as sufficient evidence that an unmerged branch is safe to delete. Clean worktrees only after checking for uncommitted changes and branch reachability.
