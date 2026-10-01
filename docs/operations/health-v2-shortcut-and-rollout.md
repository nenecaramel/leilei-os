# Health v2 Shortcut and rollout

Health v2 stores only one normalized daily summary: steps plus current
menstruation/cycle context. It is not a general HealthKit import and does not
store raw samples, device metadata, or a retained menstruation history.

This runbook is for a separately authorized production rollout. Do not put a
sync key, user ID, Health value, request body, or connection string in chat,
Git, logs, or this document.

## iPhone Shortcut

Build a Shortcut with only the following data flow:

1. Query today's Apple Health Steps and sum the result.
2. Query Apple Health Menstruation records using the Shortcut's trailing
   60-day lookback. The server accepts dates from `request date - 60 days`
   through `request date`, inclusive, so a boundary record exactly 60 days
   earlier remains valid.
3. Format each sample date as `yyyy-MM-dd`, deduplicate the strings, and use
   them as `menstruation_dates`. The request still accepts at most 60 entries;
   the inclusive date boundary does not raise that item-count limit.
4. Format the current China business date as `yyyy-MM-dd`.
5. Use **Get Contents of URL** to `POST`
   `${LEILEI_OS_BASE_URL}/api/v1/health-sync`.
6. Send a JSON body containing only:

   ```json
   {
     "date": "yyyy-MM-dd",
     "steps": 0,
     "menstruation_dates": ["yyyy-MM-dd"]
   }
   ```

   `steps` must be a numeric integer, not formatted display text.
7. Set `Content-Type: application/json` and configure
   `x-leilei-health-sync-key` privately on the device. Never include a user ID
   in the request; the server binds writes to its configured owner.
8. Run the Shortcut manually first. Enable an hourly iOS Automation only after
   that manual smoke test succeeds.

Missing an hourly run is safe: the next valid run updates the same owner/date
summary. Do not send sleep, heart-rate, workout, location, device, source-app,
or other HealthKit data.

## Production rollout order

1. Confirm fresh encrypted PostgreSQL backup and restore readiness.
2. Configure the dedicated `LEILEI_HEALTH_SYNC_KEY` (at least 32 characters)
   and `LEILEI_HEALTH_SYNC_USER_ID` production environment values through the
   existing secret-management path. Do not reuse OAuth, MCP, or Toy secrets.
3. Deploy the exact reviewed application SHA. Its Railway pre-deploy migration
   runner must apply the additive Health v2 migration before the application
   starts.
4. Verify service startup, `GET /health`, `GET /ready`, and safe runtime logs.
   The root `/health` endpoint is infrastructure liveness; it is unrelated to
   Health v2 data.
5. Verify that both ChatGPT and Claude see public read-only schemas for
   `get_health` and `get_current_time`.
6. Run the real iPhone Shortcut once manually.
7. Use `get_health` from ChatGPT and Claude to read the resulting day and
   confirm that both return the same stored steps/cycle summary.
8. Use `get_current_time` to confirm live time is returned in
   `Asia/Shanghai`.
9. Only then enable the hourly iOS Automation.

Do not create synthetic menstrual history in production merely to smoke-test
the integration. The first write must be the user's real Shortcut data or a
separately authorized non-sensitive test payload.

## Rollback and boundaries

The Health v2 migration is additive. If the application must be rolled back,
an earlier application version can ignore `health_daily_summaries`; do not
drop the table as an emergency rollback. Fix forward or use a separately
designed, explicitly authorized retirement operation.

Health v2 does not include a Web UI, ChatGPT/Claude write tool, Global Search,
export/import, the retired `health_records` table, the retired
`/api/v1/health` route, period prediction, or medical diagnosis.
