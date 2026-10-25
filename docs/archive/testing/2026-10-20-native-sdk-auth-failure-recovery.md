# Native SDK authentication-failure recovery

## Cause

A failed native SDK authentication attempt appended its input, attachments and
an SDK-generated assistant error to the local session. The error had
`isApiErrorMessage=true`, `error=authentication_failed`, model `<synthetic>`,
and zero input/output/cache tokens. The backend recorded the input as failed.
After login was restored, the existing resume-tail guard rejected that synthetic
error as if it were an unsynchronized model reply. This is distinct from the
first-send HTTP 409 fixed in PR #1174 and from the cause of OAuth refresh failure.

## Change and safety

Recognize only closed authentication-error segments whose input UUIDs are in
the backend-supplied failed set, with matching SDK entrypoint and native session.
Require the exact typed error, synthetic model, assistant role, text-only content,
stop marker and four explicit zero token counters. Real assistant output, tools,
other error types, unknown inputs and foreign/Desktop records still fail closed.
Earlier residue still passes through the existing guard. Input-only recovery
retains its previous behavior. Multiple closed failures can be superseded.

The existing exact `resumeSessionAt` path resumes the same native session.
No transcript records are deleted, rewritten or imported. No production database
changes, new model execution, Hook installation, UI or API changes are required.
The root cause of the preceding authentication-refresh failure is not resolved
or claimed resolved by this patch.

## Evidence

Node 22.23.3:

```sh
node --test --test-name-pattern='local resume recovers only proven SDK authentication failure tails' tools/claude-bridge/test/agent-sdk-claude-transport.test.mjs
pnpm --dir tools/claude-bridge test
pnpm typecheck
pnpm build
pnpm test:production-runtime-gate
```

The new behavioral transport test was RED (12 pass / 2 fail including parent)
before implementation. Final focused run: 16 pass, no failures or skips.
Full bridge: 623 pass / 0 fail / 8 existing opt-in skips.
Production runtime gate: 701 + 401 pass, no failures or skips.
Complete ordinary suite on Node 24.19.0 (`pnpm test`): 2,906 pass / 0 fail /
300 existing opt-in skips (3,206 total). Typecheck and build passed.
The recorded local failure's redacted structural
metadata also matched the new classifier in a read-only check; no private
message text or credentials were output or changed.

Independent review found no blocker. Its initial 14-case rerun used Node 26;
the implementation owner ran the final 16 cases and bridge suite on Node 22.
Two cases added after review cover repeated closed errors and ensure approved
but unclosed inputs are not classified as closed authentication failures.

Live acceptance requires loading the merged bridge code into the Mac daemon
and a user-initiated message in the original conversation. Tests do not claim
that a real Claude reply has already completed. Automatic token refresh remains
a separate investigation; successful `auth status` only proves current login.
