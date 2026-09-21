import { sql, type SQL } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import type { ContentAuthor } from "../content-author.js";

export type GlobalSearchModule = "memory" | "diary" | "task" | "todo" | "universe" | "shared_paper" | "conversation";
export type GlobalSearchScope = "active" | "archived" | "all";
export type GlobalSearchMode = "phrase" | "normal";
export type GlobalSearchMatchReason = "exact_stable_name" | "exact_phrase" | "stable_name_prefix" | "field_match";
export type GlobalSearchMatchedField = "key" | "title" | "content" | "description" | "tags" | "mood" | "text";
export type GlobalSearchTimeBasis = "updated_at" | "diary_date" | "due_time" | "created_at" | "todo_date" | "message_time";

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
  author: ContentAuthor | null;
  /** Raw Todo business date for read_todo_day pointers; never infer it from businessTime. */
  businessDate?: string | null;
  conversationId?: string | null;
  conversationView?: "default" | "all" | null;
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
    if (input.modules.includes("todo") && input.scope !== "archived") moduleQueries.push(todoQuery(input, queryText, pattern));
    if (input.modules.includes("universe") && input.scope !== "archived") moduleQueries.push(universeQuery(input, queryText, pattern, prefix));
    if (input.modules.includes("shared_paper")) moduleQueries.push(sharedPaperQuery(input, queryText, pattern, prefix));
    if (input.modules.includes("conversation")) {
      moduleQueries.push(conversationQuery(input, queryText, pattern));
    }
    if (moduleQueries.length === 0) return [];
    const union = sql.join(moduleQueries, sql` union all `);
    const result = await this.db.execute(sql<GlobalSearchRow>`
      with ranked as (${union})
      select entity_type as "entityType", entity_id as "entityId", stable_name as "stableName",
        matched_field as "matchedField", matched_value as "matchedValue", match_reason as "matchReason",
        lifecycle_status as "lifecycleStatus", business_time as "businessTime", time_basis as "timeBasis",
        updated_at as "updatedAt", business_date as "businessDate",
        conversation_id as "conversationId", conversation_view as "conversationView",
        rank, author
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
    (rank = ${cursor.rank} and business_time = ${cursor.businessTime}::timestamptz and updated_at = ${cursor.updatedAt}::timestamptz and entity_type = ${cursor.entityType} and entity_id > ${cursor.entityId})
  )`;
}

function bounded(
  query: SQL,
  input: GlobalSearchQuery,
): SQL {
  return sql`(
    select *
    from (
      select
        module_candidates.entity_type,
        module_candidates.entity_id,
        module_candidates.stable_name,
        module_candidates.matched_field,
        module_candidates.matched_value,
        module_candidates.match_reason,
        module_candidates.lifecycle_status,
        module_candidates.author,
        date_trunc('milliseconds', module_candidates.business_time) as business_time,
        module_candidates.time_basis,
        date_trunc('milliseconds', module_candidates.updated_at) as updated_at,
        module_candidates.business_date,
        module_candidates.conversation_id,
        module_candidates.conversation_view,
        ${rankExpression()} as rank
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
  return bounded(sql`select 'memory'::text entity_type, m.id::text entity_id, m.key stable_name,
    ${reasonAndField(sql`m.key`, fields, input.mode, query, pattern, prefix)}, m.status::text lifecycle_status,
    m.author::text author, m.updated_at business_time, 'updated_at'::text time_basis, m.updated_at, null::date business_date, null::text conversation_id, null::text conversation_view
    from core_memories m where m.user_id=${input.userId}::uuid and m.visibility='assistant' and ${lifecycle(sql`m.status`, input.scope)}
    and ${match(fields.map((f) => f.value), input.mode, pattern)} and ${dates(businessDate, input)}`, input);
}
function diaryQuery(input: GlobalSearchQuery, query: string, pattern: string, prefix: string): SQL {
  const tags = sql`array_to_string(d.tags, ' ')`; const mood = sql`coalesce(d.mood, '')`;
  const fields = [{ name: "title" as const, value: sql`d.title` }, { name: "content" as const, value: sql`d.content` }, { name: "tags" as const, value: tags }, { name: "mood" as const, value: mood }];
  return bounded(sql`select 'diary'::text entity_type, d.id::text entity_id, d.title stable_name,
    ${reasonAndField(sql`d.title`, fields, input.mode, query, pattern, prefix)}, d.status::text lifecycle_status,
    d.author::text author, (d.date::timestamp at time zone ${input.timezone}) business_time, 'diary_date'::text time_basis, d.updated_at, null::date business_date, null::text conversation_id, null::text conversation_view
    from diary_entries d where d.user_id=${input.userId}::uuid and ${lifecycle(sql`d.status`, input.scope)}
    and ${match(fields.map((f) => f.value), input.mode, pattern)} and ${dates(sql`d.date`, input)}`, input);
}
function taskQuery(input: GlobalSearchQuery, query: string, pattern: string, prefix: string): SQL {
  const tags = sql`array_to_string(t.tags, ' ')`;
  const fields = [{ name: "title" as const, value: sql`t.title` }, { name: "description" as const, value: sql`t.description` }, { name: "tags" as const, value: tags }];
  const effective = sql`coalesce(t.due_time, t.created_at)`; const businessDate = sql`(${effective} at time zone ${input.timezone})::date`;
  return bounded(sql`select 'task'::text entity_type, t.id::text entity_id, t.title stable_name,
    ${reasonAndField(sql`t.title`, fields, input.mode, query, pattern, prefix)}, t.lifecycle_status::text lifecycle_status,
    t.author::text author, ${effective} business_time, case when t.due_time is null then 'created_at' else 'due_time' end::text time_basis, t.updated_at, null::date business_date, null::text conversation_id, null::text conversation_view
    from tasks t where t.user_id=${input.userId}::uuid and ${lifecycle(sql`t.lifecycle_status`, input.scope)}
    and ${match(fields.map((f) => f.value), input.mode, pattern)} and ${dates(businessDate, input)}`, input);
}

function todoQuery(input: GlobalSearchQuery, query: string, pattern: string): SQL {
  const normalizedText = normalized(sql`e.text`, input.mode);
  return bounded(sql`select 'todo'::text entity_type,
    e.id::text entity_id,
    concat(to_char(p.business_date, 'YYYY-MM-DD'), ' ', p.author, ' ', e.entry_id) stable_name,
    'text'::text matched_field,
    e.text matched_value,
    case when ${normalizedText} = ${query} then 'exact_phrase' else 'field_match' end::text match_reason,
    'active'::text lifecycle_status,
    p.author::text author,
    (p.business_date::timestamp at time zone ${input.timezone}) business_time,
    'todo_date'::text time_basis,
    p.updated_at,
    p.business_date business_date, null::text conversation_id, null::text conversation_view
    from todo_entries e
    inner join todo_papers p on p.id=e.paper_id
    where p.user_id=${input.userId}::uuid
      and ${normalizedText} like ${pattern} escape '\\'
      and ${dates(sql`p.business_date`, input)}`, input);
}

function universeQuery(input: GlobalSearchQuery, query: string, pattern: string, prefix: string): SQL {
  const searchable = sql`concat_ws(' ', n.summary, n.content)`;
  const tags = sql`array_to_string(n.tags, ' ')`;
  const fields = [
    { name: "title" as const, value: sql`n.title` },
    { name: "content" as const, value: searchable },
    { name: "tags" as const, value: tags },
  ];
  const businessDate = sql`(n.updated_at at time zone ${input.timezone})::date`;
  return bounded(sql`select 'universe'::text entity_type, n.id::text entity_id, n.title stable_name,
    ${reasonAndField(sql`n.title`, fields, input.mode, query, pattern, prefix)},
    'active'::text lifecycle_status, null::text author, n.updated_at business_time, 'updated_at'::text time_basis, n.updated_at, null::date business_date, null::text conversation_id, null::text conversation_view
    from universe_nodes n
    inner join universe_meta um on um.user_id = n.user_id
    where n.user_id=${input.userId}::uuid
      and ${match(fields.map((f) => f.value), input.mode, pattern)}
      and ${dates(businessDate, input)}`, input);
}

function sharedPaperQuery(input: GlobalSearchQuery, query: string, pattern: string, prefix: string): SQL {
  const lifecycleStatus = sql`case when p.archived_at is null then 'active' else 'archived' end`;
  const fields = [
    { name: "title" as const, value: sql`p.title` },
    { name: "content" as const, value: sql`p.content` },
  ];
  const businessDate = sql`(p.updated_at at time zone ${input.timezone})::date`;
  return bounded(sql`select 'shared_paper'::text entity_type, p.id::text entity_id, p.title stable_name,
    ${reasonAndField(sql`p.title`, fields, input.mode, query, pattern, prefix)},
    ${lifecycleStatus}::text lifecycle_status, p.updated_by::text author,
    p.updated_at business_time, 'updated_at'::text time_basis, p.updated_at, null::date business_date, null::text conversation_id, null::text conversation_view
    from shared_papers p
    where p.user_id=${input.userId}::uuid
      and ${lifecycle(lifecycleStatus, input.scope)}
      and ${match(fields.map((f) => f.value), input.mode, pattern)}
      and ${dates(businessDate, input)}`, input);
}


function conversationQuery(
  input: GlobalSearchQuery,
  query: string,
  pattern: string,
): SQL {
  const text = normalized(sql`m.display_text`, input.mode);
  const effectiveTime = sql`coalesce(m.source_created_at, m.created_at)`;
  const businessDate = sql`(${effectiveTime} at time zone ${input.timezone})::date`;
  const lifecycleStatus = sql`case when c.archived_at is null then 'active' else 'archived' end`;
  return bounded(sql`select
    'conversation'::text entity_type,
    m.id::text entity_id,
    coalesce(nullif(btrim(c.title), ''), 'Untitled conversation') stable_name,
    'text'::text matched_field,
    m.display_text matched_value,
    case when ${text} = lower(${query}) then 'exact_phrase' else 'field_match' end::text match_reason,
    ${lifecycleStatus}::text lifecycle_status,
    null::text author,
    ${effectiveTime} business_time,
    'message_time'::text time_basis,
    m.updated_at,
    null::date business_date,
    c.id::text conversation_id,
    case
      when c.provider = 'chatgpt' and m.is_current_path = false then 'all'
      else 'default'
    end::text conversation_view
    from conversation_messages m
    inner join conversations c
      on c.id = m.conversation_id
      and c.user_id = m.user_id
    where m.user_id = ${input.userId}::uuid
      and c.origin = 'legacy_import'
      and c.deleted_at is null
      and ${lifecycle(lifecycleStatus, input.scope)}
      and m.is_primary = true
      and m.role in ('user', 'assistant')
      and not exists (
        select 1
        from conversation_deleted_branches deleted_branch
        where deleted_branch.user_id = m.user_id
          and deleted_branch.conversation_id = m.conversation_id
          and exists (
            with recursive branch_nodes(source_node_id) as (
              select deleted_branch.source_node_id
              union all
              select descendant.source_node_id
              from conversation_messages descendant
              join branch_nodes parent on descendant.parent_source_node_id = parent.source_node_id
              where descendant.conversation_id = deleted_branch.conversation_id
            )
            select 1
            from branch_nodes
            where branch_nodes.source_node_id = m.source_node_id
          )
      )
      and ${text} like ${pattern} escape '\\'
      and ${dates(businessDate, input)}`, input);
}
