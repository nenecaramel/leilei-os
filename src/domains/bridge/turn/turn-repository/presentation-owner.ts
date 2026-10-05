import { sql, type SQL } from "drizzle-orm";
import { conversations } from "../../../../database/schema.js";

/**
 * A replacement may only recover/commit against the canonical head captured
 * by its preparation. Missing ownership evidence cannot authorize a purge.
 * Writers must evaluate this while holding the conversation row lock.
 */
export function matchesPresentationOwner(prepareId: string | SQL): SQL<boolean> {
  const owner = sql`${conversations.providerMetadata}->'native_live_presentation_owner'`;
  return sql<boolean>`coalesce(
    (${owner}->>'prepareId' = ${prepareId}::text)
    AND (${owner} ? 'anchorHeadMessageId')
    AND ((${owner}->>'anchorHeadMessageId') IS NOT DISTINCT FROM ${conversations.currentHeadMessageId}::text),
    false
  )`;
}
