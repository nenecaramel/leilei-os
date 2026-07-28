# Task due time and account timezone rollout

## Audited starting model

Before migration `0007_perpetual_bedlam`, `tasks.due_time` is a non-null
PostgreSQL `timestamp with time zone`. Task writes accept an ISO 8601 instant
with `Z` or an explicit offset and convert it to a JavaScript `Date` before
Drizzle writes it. Existing values therefore represent absolute instants.

The migration does not change the column type, run an `UPDATE`, or rewrite any
task row. It only drops the `NOT NULL` constraint and adds
`user_settings.timezone`, defaulting existing settings rows to
`Asia/Shanghai`.

## Product rules

- A task may have no due date.
- Dated tasks remain UTC instants in PostgreSQL.
- The account timezone is an IANA timezone stored in `user_settings`.
- `Asia/Shanghai` is the single-user default.
- Browser timezone detection is only a suggestion; it never silently updates
  the account.
- Changing the account timezone changes display and time buckets, not stored
  due instants.
- Local midnight boundaries are calculated in the account timezone and then
  converted to UTC.
- Undated tasks sort after dated tasks.

## Deployment sequence

1. Confirm a recent encrypted production backup and successful restore drill.
2. Deploy or otherwise make migration `0007_perpetual_bedlam` available.
3. Run the existing migration command once against the intended environment:
   `npm run db:migrate`.
4. Verify:
   - `tasks.due_time` is nullable and remains `timestamp with time zone`;
   - existing task IDs, statuses, and UTC due instants are unchanged;
   - `user_settings.timezone` exists, is non-null, and existing rows contain
     `Asia/Shanghai`;
   - creating and reading both dated and undated tasks succeeds.
5. Deploy the application and perform Web, API, MCP, filter, and Dashboard
   smoke checks.

This PR does not execute the production migration.

## Rollback and forward repair

Before any undated task is created, a rollback can remove the timezone column
and restore `tasks.due_time NOT NULL` after first verifying that the column
contains no null values.

After undated tasks exist, restoring `NOT NULL` would be destructive or require
inventing dates. Do not do that. Prefer a forward repair:

1. keep `due_time` nullable;
2. correct application validation or timezone configuration;
3. deploy the fix;
4. preserve all existing UTC instants and null values.

Never convert `due_time` to `timestamp without time zone`, apply a fixed UTC+8
offset, or update stored due instants when an account timezone changes.
