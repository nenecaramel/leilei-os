# Branch and release policy

## Canonical trunk

`main` is the only formal integration, development, and release trunk.

- GitHub default branch: `main`.
- Railway Production source: `main`.
- Vercel Production Branch: `main`.
- Feature, maintenance, and experiment branches are short-lived work branches;
  they enter `main` only through a reviewed pull request.
- `codex/phase-6-web-ui-foundation` is a historical integration branch, not an
  active trunk. Keep it only while an open pull request or explicit release
  obligation depends on it.

## Integration rules

1. All changes enter the integration trunk through a pull request.
2. Direct pushes, force-pushes, reset/rebase rewrites, and merge commits made
   outside the reviewed pull request are not part of the normal workflow.
3. A pull request must document its scope, migration impact, production impact,
   and the tests/build gates that were actually run.
4. Draft pull requests are review work, not release evidence. A branch is not
   production-accepted until the required deployment and database checks are
   recorded separately.

## Release flow

1. Branch from the latest `main` and keep the work focused on one change.
2. Run the applicable root/Web tests, typechecks, builds, and database gates;
   record skipped gates and their reasons.
3. Open a reviewed pull request back to `main` with scope, migration impact,
   production impact, and verification evidence.
4. Merge only after review and deployment/migration ownership are confirmed.
5. Deployments follow `main`; record the accepted release SHA and production
   result after the platform reports success.

## Historical branches

Merged or superseded branches are archived only after their pull-request state
and patch equivalence have been checked. Open work, branches with unique
unreviewed commits, and branches referenced by an active pull request are kept
until their owner explicitly closes or supersedes them.
