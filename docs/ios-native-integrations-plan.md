# LeileiOS native integrations — implementation plan

Status: specification; not yet implemented. This document is intentionally non-operational and does not enable device permissions or send notifications.

## Phase 1: APNs assistant-message notifications

**Product rule:** When Claude creates a new user-visible assistant message and LeileiOS is not foreground-active on that device, send an APNs alert with a message-text preview. Do not send alerts for thinking deltas, tool events, imported or replayed history, or each streaming token.

- iOS: request notification authorization explicitly, register for remote notifications, securely upload and rotate APNs device tokens tied to the authenticated account, and report app foreground/background state with a bounded expiry. Support notification taps/deep links into the exact conversation.
- Backend: persist account-scoped device registrations and token state; detect committed, newly generated assistant messages at the canonical message completion boundary; enqueue idempotent deliveries keyed by recipient/device/message; deliver through APNs using server-side credentials and retry transient failures.
- Background policy: foreground devices should not receive an alert; stale presence must be treated as unknown, not as proof of foreground. If presence is unknown, prefer notification to silently missing a message. Handle multiple devices separately.
- Preview: derive bounded plain text from actual user-visible assistant text, excluding thinking, tool inputs/outputs, secrets, and unsupported media; use a generic fallback for messages without suitable preview text. Respect OS notification-preview and Focus settings. Never log message bodies or APNs payloads.
- Security: verify user authorization for registration, device deletion, and deep links; never expose APNs credentials or arbitrary-user device tokens; reject cross-account requests.
- Tests: idempotency, multiple devices, foreground/background/stale presence, invalid token removal, concurrent sends, imported-history suppression, preview redaction/truncation, and deep-link authorization.
- Deployment prerequisites: enable Push Notifications and remote-notification entitlement for the actual Apple App ID, provision APNs authentication in Railway secrets, test on a physical iPhone. Do not commit secrets or enable production delivery before verification.

## Phase 2: Apple HealthKit

- Add the HealthKit capability and the required privacy usage strings. Ask separately for read access to steps, sleep, heart rate, activity energy, and workouts. Handle unavailable devices, denied permissions, and partial data.
- Default to device-local, read-only access. Show clear data types and time ranges. Send selected, minimal aggregates to Claude only after a separate explicit user action/consent; avoid background export by default.
- Do not equate the existing `health_daily_summaries` database table with HealthKit integration or silently overwrite its manually tracked fields.
- Tests: authorization and partial permissions, unit/timezone handling, sleep intervals, data deduplication, privacy and consent revocation.

## Phase 3: Apple EventKit calendar and reminders

- Request calendar and reminders permissions separately and only on demand. Read schedules and reminders, show source calendars/lists, and allow explicit creation, editing, and completion actions.
- Treat existing LeileiOS todo entries as a distinct system. Store stable external identifiers and sync provenance before enabling two-way synchronization; prevent duplicate writes and feedback loops.
- Tests: authorization denied, timezone and all-day events, recurrence, conflict handling, identifier changes, duplicates, and write confirmation.

## Release sequence

Implement each phase in its own PR with isolated unit/integration tests, a device test checklist, and a security review. Merge only after verification; keep the next phase independent of the prior phase's Apple entitlement setup.
