# Connector automatic-renewal verification

Baseline: `4637376440f01ce3d22deb96a2cad63191ccb52a` (#1172).

## Scope

Complete the existing Auth0-backed adapter rather than replace authentication.
Changes are OAuth token exchange/refresh, client metadata/JWKS error classification,
code expiry metadata, opt-in key configuration/application wiring, tests and docs.
No schema, database mutation, new dependency, Web/iOS UI, Hook or daemon change.

A dedicated persistent key enables encrypted refresh envelopes bound to client,
subject, resource, audience and scope. The absolute 30-day grant expiry survives
server restart and is retained on rotation. Auth0 remains responsible for upstream
rotation/reuse detection/revocation. No key means legacy access-only operation.
Network/JWKS/configuration failures return temporary errors rather than falsely
invalidating credentials. A lost upstream rotation response remains ambiguous;
the code does not blindly replay it. Details and live prerequisites are in
`docs/deployment.md`.

## Executed evidence

- New upstream regression first failed: existing code discarded `expires_in` and
  `refresh_token` (2 pass / 1 fail). After implementation it passes.
- Review-added metadata/JWKS outage tests first failed (13 pass / 2 fail): 400
  instead of 503. Fixed typed fetch/verification classification, preserving strict
  metadata parsing, signatures, claims and replay checks. Added private-key JWKS
  failure/cooldown cases too.
- Node 22.23.3 `node --import tsx --test tests/oauth-*.test.ts`: **80 pass, 0 fail,
  0 skip**. Covers full synthetic consent→callback→code→refresh HTTP flow, real
  RSA client assertions, elapsed expiry, restart, absolute expiry, wrong client/
  scope/resource/audience/subject, tamper/key/issuer mismatch, revoked/replayed
  upstream rotation, concurrency barriers, missing rotation, malformed/oversized
  bodies, timeout, transient classification, log safety and no-key compatibility.
- Real app wiring tests exercise the enabled key in a fresh child process because
  runtime environment is intentionally parsed once at startup. An initial
  in-process two-configuration fixture failed due to module caching; production
  code was not changed to satisfy that fixture.
- Final full ordinary suite (Node 24.19.0 / pnpm 11.9.0): **2,906 pass / 0 fail /
  298 opt-in skips, 3,204 total**. Compared with the last full #1171 run, +23 passes and +1 opt-in skip from
  #1172’s separately executed simulator test. Database,
  device, host/model opt-ins and ambient DATABASE_URL were removed from this run.
- Node 22 root typecheck/build: PASS. Production runtime gate: **701 + 385 pass,
  0 fail, 0 skip**. This includes the unchanged bridge runtime gate.
- Independent final review: no remaining blocker; reviewer separately ran 39
  focused tests and did not inspect credentials or contact production.

## Live status boundary

Read-only production variable inventory confirmed the new key is absent and no
Auth0 management connection is configured. No key, credentials, tokens or private
configuration values were printed. Live Auth0 offline-access/application-grant/
rotation configuration and a real connector renewal must be verified separately;
local tests are not evidence that production is enabled. Production changes need
authorization and the actual authenticated management connection. No live confirm,
product write, daemon restart or installed Hook action is part of this change.
