# Historical engineering plans and specs

This directory is an **archive of dated design decisions, implementation plans and verification evidence**. A checkbox, "Draft", "pending" or "not merged" statement here describes its **original writing/closeout date**, not necessarily the current state of `main`. Do not execute historical release, migration, cleanup or daemon commands without checking the current repository and live environment.

## Start with current documentation

- [Repository overview](../../README.md), [architecture](../architecture.md), [deployment](../deployment.md), and [branch/release policy](../branch-release-policy.md).
- [Current Mind Hook operation and pause switch](../claude-code-mind.md); [current manual Desktop ↔ LeileiOS session switching](../native-session/catalog.md).
- [Mind product behavior](../mind.md), [Memory API and UI](../mind-memory-api.md), and [troubleshooting](../troubleshooting.md).

## Historical design/verification index

| Date | Topic | Historical artifacts |
| --- | --- | --- |
| 2026-10-02 | Repository maintainability and chat boundaries | [maintainability spec](specs/2026-10-02-repository-maintainability-refactor-design.md), [chat boundaries plan](plans/2026-10-02-chat-surface-boundaries.md) |
| 2026-10-03 | Message/attachment/presentation contracts | [attachment foundation](plans/2026-10-03-attachment-media-foundation.md), [message presentation](plans/2026-10-03-message-presentation-model-v2.md), [message canonical contract](plans/2026-10-03-message-surface-canonical-contract.md) |
| 2026-10-03 | Rendering and structured results | [rich Markdown](plans/2026-10-03-rich-markdown.md), [tool/search citations](plans/2026-10-03-structured-tool-search-citation.md), [visual renderer plan](plans/2026-10-03-visual-renderer-foundation.md), [visual renderer spec](specs/2026-10-03-visual-renderer-foundation.md) |
| 2026-10-04 | Claude turn lifecycle | [full spec](specs/2026-10-04-claude-turn-lifecycle.md), [implementation/verification plan](plans/2026-10-04-claude-turn-lifecycle.md) |
| 2026-10-06 | Native branch session and checkpoints | [full spec](specs/2026-10-06-native-live-branch-session.md), [implementation plan](plans/2026-10-06-native-live-branch-session.md), [verification record](plans/2026-10-06-native-live-branch-session-verification.md), [correctness-gate follow-up](plans/2026-10-06-branch-session-correctness-gates-pending.md) |

The branch-session implementation plan's original closeout says PR #908 was Draft, but [PR #908](https://github.com/nenecaramel/leilei-os/pull/908) **merged 2026-10-06**. Its production/device acceptance remains separate. Similar status wording in other historical plans must be checked against GitHub and current code, not automatically promoted to current truth.

Keep these files for historical provenance and test reasoning, rather than copying their long checklists into `AGENTS.md` or current operational guides. Adding new/current instructions here creates ambiguity: update the authoritative document instead.

## Dated verification and handoff records

- [behavior-coverage-review](testing/2026-10-19-behavior-coverage-review.md)
- [oauth-connector-refresh](testing/2026-10-19-oauth-connector-refresh.md)
- [settings-hosted-acceptance](testing/2026-10-19-settings-hosted-acceptance.md)
- [universe-settings-behavior](testing/2026-10-19-universe-settings-behavior.md)
- [claude-code-handoff](testing/2026-10-20-claude-code-handoff.md)
- [native-continuation-input-binding](testing/2026-10-20-native-continuation-input-binding.md)
- [native-edit-execution-route](testing/2026-10-20-native-edit-execution-route.md)
- [native-runtime-reliability](testing/2026-10-20-native-runtime-reliability.md)
- [native-sdk-auth-failure-recovery](testing/2026-10-20-native-sdk-auth-failure-recovery.md)
- [runtime-reliability-plan](testing/2026-10-20-runtime-reliability-plan.md)
