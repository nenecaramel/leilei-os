import { sql, type SQL } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";

export type GlobalSearchModule = "memory" | "diary" | "task";
export type GlobalSearchScope = "active" | "archived" | "all";
export type GlobalSearchMode = "phrase" | "normal";
export type GlobalSearchMatchReason = "exact_stable_name" | "exact_phrase" | "stable_name_prefix" | "field_match";
export type GlobalSearchMatchedField = "key" | "title" | "content" | "description" | "tags" | "mood";
export type GlobalSearchTimeBasis = "updated_at" | "diary_date" | "due_time" | "created_at";

export type GlobalSearchUser = { status: "active" | "disabled"; timezone: string };
export type GlobalSearchCursorTuple = { rank: number; businessTime: string; updatedAt: string; entityType: GlobalSearchModule; entityId: string };
export type GlobalSearchQuery = {
  userId: string;
  query: string;
  modules: readonly GlobalSearchModule[];
  scope: GlobalSearchScope;
  mode: GlobalSearchMode;
  dateFrom?: string;
  dateTo?: string;
  timezone: string;
  limit: number;
  after?: GlobalSearchCursorTuple;
};
export type GlobalSearchRow = {
  entityType: GlobalSearchModule;
  entityId: string;
  stableName: string;
  matchedField: GlobalSearchMatchedField;
  matchedValue: string;
  matchReason: GlobalSearchMatchReason;
  lifecycleStatus: "active" | "archived";
  businessTime: Date;
  timeBasis: GlobalSearchTimeBasis;
  updatedAt: Date;
  rank: number;
};

export interface GlobalSearchRepository {
  findUser(userId: string): Promise<GlobalSearchUser | null>;
  search(input: GlobalSearchQuery): Promise<GlobalSearchRow[]>;
}

type Database = ReturnType<typeof createDatabase>["db"];

export class DrizzleGlobalSearchRepository implements GlobalSearchRepository {
  constructor(private readonly db: Database) {}

  async findUser(userId: string): Promise<GlobalSearchUser | null> {
    const result = await this.db.execute(sql<GlobalSearchUser>`
      select u.status, coalesce(s.timezone, 'Asia/Shanghai') as timezone
      from users u left join user_settings s on s.user_id = u.id
      where u.id = ${userId}::uuid limit 1
    `);
    return (result[0] as GlobalSearchUser | undefined) ?? null;
  }

  async search(input: GlobalSearchQuery): Promise<GlobalSearchRow[]> {
    const queryText = (input.mode === "normal" ? input.query.replace(/\s+/gu, " ") : input.query).toLocaleLowerCase();
    const pattern = `%${escapeLike(queryText)}%`;
    const prefix = `${escapeLike(queryText)}%`;
    const moduleQueries: SQL[] = [];
    if (input.modules.includes("memory")) moduleQueries.push(memoryQuery(input, queryText, pattern, prefix));
    if (input.modules.includes("diary")) moduleQueries.push(diaryQuery(input, queryText, pattern, prefix));
    if (input.modules.includes("task")) moduleQueries.push(taskQuery(input, queryText, pattern, prefix));
    const union = sql.join(moduleQueries, sql` union all `);
    const result = await this.db.execute(sql<GlobalSearchRow>`
      with ranked as (${union})
      select entity_type as "entityType", entity_id as "entityId", stable_name as "stableName",
        matched_field as "matchedField", matched_value as "matchedValue", match_reason as "matchReason",
        lifecycle_status as "lifecycleStatus", business_time as "businessTime", time_basis as "timeBasis",
        updated_at as "updatedAt", rank
      from ranked
      order by rank asc, business_time desc, updated_at desc, entity_type asc, entity_id asc
      limit ${input.limit}
    `);
    return ([...result] as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      businessTime: row.businessTime instanceof Date ? row.businessTime : new Date(String(row.businessTime)),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(String(row.updatedAt)),
      rank: Number(row.rank),
    })) as unknown as GlobalSearchRow[];
  }
}

function escapeLike(value: string): string { return value.replace(/[\\%_]/gu, "\\$&"); }
function lifecycle(column: SQL, scope: GlobalSearchScope): SQL {
  return scope === "all" ? sql`${column} in ('active', 'archived')` : sql`${column} = ${scope}`;
}
function dates(expr: SQL, input: GlobalSearchQuery): SQL {
  return sql`${input.dateFrom ? sql`${expr} >= ${input.dateFrom}::date` : sql`true`} and ${input.dateTo ? sql`${expr} <= ${input.dateTo}::date` : sql`true`}`;
}
function normalized(expr: SQL, mode: GlobalSearchMode): SQL {
  return mode === "normal" ? sql`regexp_replace(lower(normalize(${expr}, NFC)), '\\s+', ' ', 'g')` : sql`lower(normalize(${expr}, NFC))`;
}
function rankExpression(): SQL {
  return sql`case match_reason
    when 'exact_stable_name' then 1
    when 'exact_phrase' then 2
    when 'stable_name_prefix' then 3
    else 4
  end`;
}

function cursorPredicate(
  cursor: GlobalSearchCursorTuple | undefined,
): SQL {
  if (!cursor) return sql`true`;

  return sql`(
    rank > ${cursor.rank} or
    (rank = ${cursor.rank} and business_time < ${cursor.businessTime}::timestamptz) or
    (rank = ${cursor.rank} and business_time = ${cursor.businessTime}::timestamptz and updated_at < ${cursor.updatedAt}::timestamptz) or
    (rank = ${cursor.rank} and business_time = ${cursor.businessTime}::timestamptz and updated_at = ${cursor.updatedAt}::timestamptz and entity_type > ${cursor.entityType}) or
    (rank = ${cursor.rank} and business_time = ${cursor.businessTime}::timestamptz and updated_at = ${cursor.updatedAt}::timestamptz and entity_type = ${cursor.entityType} and entity_id > ${cursor.entityId}::uuid)
  )`;
}

function bounded(
  query: SQL,
  input: GlobalSearchQuery,
): SQL {
  return sql`(
    select *
    from (
      select module_candidates.*, ${rankExpression()} as rank
      from (${query}) module_candidates
    ) ranked_module_candidates
    where ${cursorPredicate(input.after)}
    order by rank asc, business_time desc, updated_at desc, entity_type asc, entity_id asc
    limit ${input.limit}
  )`;
}

function reasonAndField(stable: SQL, fields: Array<{ name: GlobalSearchMatchedField; value: SQL }>, mode: GlobalSearchMode, query: string, pattern: string, prefix: string): SQL {
  const normStable = normalized(stable, mode);
  const exactPhrase = fields.map(({ value }) => sql`${normalized(value, mode)} = lower(${query})`);
  const matchedField = fields.map(({ name, value }) => sql`when ${normalized(value, mode)} like ${pattern} escape '\\' then ${name}`);
  const matchedValue = fields.map(({ value }) => sql`when ${normalized(value, mode)} like ${pattern} escape '\\' then ${value}`);
  return sql`
    case when ${normStable} = lower(${query}) then 'exact_stable_name'
      when (${sql.join(exactPhrase, sql` or `)}) then 'exact_phrase'
      when ${normStable} like ${prefix} escape '\\' then 'stable_name_prefix' else 'field_match' end as match_reason,
    case ${sql.join(matchedField, sql` `)} end as matched_field,
    case ${sql.join(matchedValue, sql` `)} end as matched_value
  `;
}
function match(fields: SQL[], mode: GlobalSearchMode, pattern: string): SQL {
  return sql`(${sql.join(fields.map((field) => sql`${normalized(field, mode)} like ${pattern} escape '\\'`), sql` or `)})`;
}
function memoryQuery(input: GlobalSearchQuery, query: string, pattern: string, prefix: string): SQL {
  const tags = sql`array_to_string(m.tags, ' ')`;
  const fields = [{ name: "key" as const, value: sql`m.key` }, { name: "content" as const, value: sql`m.content` }, { name: "tags" as const, value: tags }];
  const businessDate = sql`(m.updated_at at time zone ${input.timezone})::date`;
  return bounded(sql`select 'memory'::text entity_type, m.id entity_id, m.key stable_name,
    ${reasonAndField(sql`m.key`, fields, input.mode, query, pattern, prefix)}, m.status::text lifecycle_status,
    m.updated_at business_time, 'updated_at'::text time_basis, m.updated_at
    from core_memories m where m.user_id=${input.userId}::uuid and m.visibility='assistant' and ${lifecycle(sql`m.status`, input.scope)}
    and ${match(fields.map((f) => f.value), input.mode, pattern)} and ${dates(businessDate, input)}`, input);
}
function diaryQuery(input: GlobalSearchQuery, query: string, pattern: string, prefix: string): SQL {
  const tags = sql`array_to_string(d.tags, ' ')`; const mood = sql`coalesce(d.mood, '')`;
  const fields = [{ name: "title" as const, value: sql`d.title` }, { name: "content" as const, value: sql`d.content` }, { name: "tags" as const, value: tags }, { name: "mood" as const, value: mood }];
  return bounded(sql`select 'diary'::text entity_type, d.id entity_id, d.title stable_name,
    ${reasonAndField(sql`d.title`, fields, input.mode, query, pattern, prefix)}, d.status::text lifecycle_status,
    (d.date::timestamp at time zone ${input.timezone}) business_time, 'diary_date'::text time_basis, d.updated_at
    from diary_entries d where d.user_id=${input.userId}::uuid and ${lifecycle(sql`d.status`, input.scope)}
    and ${match(fields.map((f) => f.value), input.mode, pattern)} and ${dates(sql`d.date`, input)}`, input);
}
function taskQuery(input: GlobalSearchQuery, query: string, pattern: string, prefix: string): SQL {
  const tags = sql`array_to_string(t.tags, ' ')`;
  const fields = [{ name: "title" as const, value: sql`t.title` }, { name: "description" as const, value: sql`t.description` }, { name: "tags" as const, value: tags }];
  const effective = sql`coalesce(t.due_time, t.created_at)`; const businessDate = sql`(${effective} at time zone ${input.timezone})::date`;
  return bounded(sql`select 'task'::text entity_type, t.id entity_id, t.title stable_name,
    ${reasonAndField(sql`t.title`, fields, input.mode, query, pattern, prefix)}, t.lifecycle_status::text lifecycle_status,
    ${effective} business_time, case when t.due_time is null then 'created_at' else 'due_time' end::text time_basis, t.updated_at
    from tasks t where t.user_id=${input.userId}::uuid and ${lifecycle(sql`t.lifecycle_status`, input.scope)}
    and ${match(fields.map((f) => f.value), input.mode, pattern)} and ${dates(businessDate, input)}`, input);
}
