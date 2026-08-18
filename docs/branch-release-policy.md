# Branch and release policy

## Branch roles

- `codex/phase-6-web-ui-foundation` is the current integration trunk and the
  source branch for release review.
- `main` remains the GitHub default branch until an explicit promotion decision
  is approved. It is not the current integration source and must not be used
  for deployment while it is behind the integration trunk.
- Feature, maintenance, and experiment branches must use a dedicated branch
  name and must not receive unrelated changes.

## Integration rules

1. All changes enter the integration trunk through a pull request.
2. Direct pushes, force-pushes, reset/rebase rewrites, and merge commits made
   outside the reviewed pull request are not part of the normal workflow.
3. A pull request must document its scope, migration impact, production impact,
   and the tests/build gates that were actually run.
4. Draft pull requests are review work, not release evidence. A branch is not
   production-accepted until the required deployment and database checks are
   recorded separately.

## Promotion to `main`

Promotion is a deliberate release step, not an automatic branch cleanup:

1. finish or explicitly defer all open integration work;
2. run the full root/Web verification and the applicable disposable database
   gates;
3. open a reviewed promotion pull request from the integration trunk to
   `main`;
4. merge only after production migration/deployment ownership is confirmed;
5. tag the accepted release SHA and record the production deployment result.

Until that promotion is approved, keep `main` unchanged and treat the
integration trunk as the only shared development/release-candidate source.

## Historical branches

Merged or superseded branches are archived only after their pull-request state
and patch equivalence have been checked. Open work, branches with unique
unreviewed commits, and branches referenced by an active pull request are kept
until their owner explicitly closes or supersedes them.
