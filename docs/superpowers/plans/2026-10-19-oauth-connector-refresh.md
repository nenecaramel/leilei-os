# Connector OAuth refresh implementation plan

Goal: complete the authorized connector automatic-renewal fix without widening token lifetimes or relying on process-local refresh state.

Design: preserve Auth0 access-token verification and PKCE/client-assertion authentication. Add bounded upstream refresh exchange and actual expiry propagation. When an explicit persistent encryption key is configured, advertise refresh/offline access and issue authenticated encrypted, client/resource/audience/scope/subject-bound refresh envelopes. Auth0 owns upstream refresh rotation/reuse detection/revocation; no refresh secrets go in logs or a new database. Envelopes retain their initial bounded absolute expiry across rotations and survive server restart with the same key. Legacy access-only operation remains available without the key. Enabling live renewal requires verifying Auth0 offline access, application refresh grant and rotation configuration, and a stable new encryption key; do not claim live success before that validation.

- [x] Reproduce missing refresh and expiry behavior with synthetic HTTP tests.
- [x] Implement upstream token parsing/refresh, secure envelope, code metadata, token routing/client fences and env/app wiring.
- [x] Test restart, concurrent/replayed refresh (upstream rotation), wrong client/scope/resource, tamper/expiry, private_key_jwt, timeout/transient failures, log safety and access-only compatibility.
- [x] Run OAuth targeted tests, root typecheck/build/runtime gate and complete suite as appropriate; independent review.
- [ ] Open/update PR, report live-configuration prerequisite and merge/deployment status separately; preserve main, no credentials printed and no daemon/Hook actions.
