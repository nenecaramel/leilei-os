import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { count, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { DrizzleGlobalSearchRepository } from "../src/domains/global-search/global-search-repository.js";
import { GlobalSearchService } from "../src/domains/global-search/global-search-service.js";
import { MemoryService } from "../src/domains/memory/memory-service.js";
import { DrizzleMemoryRepository } from "../src/domains/memory/memory-repository.js";
import { DiaryService } from "../src/domains/diary/diary-service.js";
import { DrizzleDiaryRepository } from "../src/domains/diary/diary-repository.js";
import { TaskService } from "../src/domains/task/task-service.js";
import { DrizzleTaskRepository } from "../src/domains/task/task-repository.js";

const url=process.env.DATABASE_URL; const parsed=url?new URL(url):null;
const RUN=process.env.RUN_GLOBAL_SEARCH_DATABASE_TEST==="1"&&Boolean(url)&&(parsed?.hostname==="127.0.0.1"||parsed?.hostname==="localhost");
class Rollback extends Error {}

test("real PostgreSQL global search covers fields, ranking, scope, dates, pagination, identity, details, and zero side effects",{skip:!RUN},async()=>{
  const client=postgres(url!,{max:1,prepare:false,ssl:false}); const db=drizzle(client,{schema});
  try {
    await assert.rejects(db.transaction(async(tx)=>{
      const owner=randomUUID(),other=randomUUID(); const now=new Date("2026-08-01T08:00:00Z");
      await tx.insert(schema.users).values([{id:owner,email:`global-${owner}@example.invalid`,displayName:"Owner",status:"active"},{id:other,email:`global-${other}@example.invalid`,displayName:"Other",status:"active"}]);
      await tx.insert(schema.userSettings).values([{userId:owner,timezone:"Asia/Shanghai"},{userId:other,timezone:"Asia/Shanghai"}]);
      const memoryIds=[randomUUID(),randomUUID()];
      await tx.insert(schema.coreMemories).values([
        {id:memoryIds[0],userId:owner,category:"project",key:"精确计划",content:"前文，命中短语：海边旅行；后文。 Space   Format Café",tags:["记忆标签"],visibility:"assistant",source:"web",status:"active",updatedAt:now},
        {id:memoryIds[1],userId:owner,category:"goal",key:"历史计划",content:"归档 Memory 正文",tags:["历史标签"],visibility:"assistant",source:"web",status:"archived",updatedAt:new Date("2026-07-31T08:00:00Z")},
        {id:randomUUID(),userId:other,category:"project",key:"精确计划",content:"不能泄露",tags:["记忆标签"],visibility:"assistant",source:"web",status:"active",updatedAt:now},
      ]);
      const diaryIds=[randomUUID(),randomUUID()];
      const diary=(id:string,status:"active"|"archived",title:string,content:string,tags:string[],mood:string)=>({id,userId:owner,title,content,date:"2026-08-01",tags,mood,source:"chatgpt_mcp" as const,status,idempotencyKey:`global-${id}`,requestHash:"a".repeat(64),createdAt:now,updatedAt:now});
      await tx.insert(schema.diaryEntries).values([diary(diaryIds[0],"active","精确计划","日记正文字段",["日记标签"],"平静心情"),diary(diaryIds[1],"archived","归档日记","历史日记正文",["历史日记"],"怀念")]);
      const taskIds=[randomUUID(),randomUUID()];
      await tx.insert(schema.tasks).values([
        {id:taskIds[0],userId:owner,title:"精确计划",description:"任务描述字段",status:"pending",lifecycleStatus:"active",priority:"normal",dueTime:null,timezone:"Asia/Shanghai",tags:["任务标签"],createdAt:now,updatedAt:now},
        {id:taskIds[1],userId:owner,title:"归档任务",description:"历史任务正文",status:"completed",resumeStatus:"in_progress",lifecycleStatus:"archived",priority:"low",dueTime:new Date("2026-07-30T08:00:00Z"),timezone:"Asia/Shanghai",tags:["历史任务"],createdAt:now,updatedAt:now,completedAt:now},
      ]);
      const before={tool:(await tx.select({v:count()}).from(schema.toolCalls))[0]!.v,life:(await tx.select({v:count()}).from(schema.resourceLifecycleEvents))[0]!.v,idem:(await tx.select({v:count()}).from(schema.mcpWriteIdempotency))[0]!.v};
      const service=new GlobalSearchService(new DrizzleGlobalSearchRepository(tx as never));
      const matrix=["精确计划","命中短语：海边旅行；","记忆标签","日记正文字段","日记标签","平静心情","任务描述字段","任务标签","space format","cafe\u0301"];
      for(const query of matrix){const found=await service.search({userId:owner,query,scope:"active",limit:25});assert.ok(found.results.length>=1,query);assert.ok(found.results.every((r)=>r.snippet.length<=242));}
      const ranked=await service.search({userId:owner,query:"精确计划",scope:"active",limit:25});assert.deepEqual(ranked.results.map((r)=>r.match_reason),["exact_stable_name","exact_stable_name","exact_stable_name"]);assert.equal(ranked.results.some((r)=>r.entity_id===memoryIds[0]),true);assert.equal(ranked.results.some((r)=>r.stable_name==="不能泄露"),false);
      const archived=await service.search({userId:owner,query:"历史",scope:"archived",limit:25});assert.equal(archived.results.length,3);assert.ok(archived.results.every((r)=>r.lifecycle_status==="archived"&&r.detail_arguments.scope==="archived"));
      const dated=await service.search({userId:owner,query:"精确计划",date_from:"2026-08-01",date_to:"2026-08-01",limit:25});assert.equal(dated.results.length,3);
      const p1=await service.search({userId:owner,query:"精确计划",limit:1});const p2=await service.search({userId:owner,query:"精确计划",limit:1,cursor:p1.metadata.next_cursor!});assert.notEqual(p1.results[0]?.entity_id,p2.results[0]?.entity_id);
      const memoryDetail=await new MemoryService(new DrizzleMemoryRepository(tx as never)).readArchivedMemoryDetail({userId:owner,id:memoryIds[1]});assert.equal(memoryDetail.content,"归档 Memory 正文");
      const diaryDetail=await new DiaryService(new DrizzleDiaryRepository(tx as never)).readArchivedDiary({userId:owner,id:diaryIds[1]});assert.equal(diaryDetail.content,"历史日记正文");
      const taskDetail=await new TaskService(new DrizzleTaskRepository(tx as never),()=>now).readArchivedTask({userId:owner,id:taskIds[1]});assert.equal(taskDetail.description,"历史任务正文");
      assert.deepEqual({tool:(await tx.select({v:count()}).from(schema.toolCalls))[0]!.v,life:(await tx.select({v:count()}).from(schema.resourceLifecycleEvents))[0]!.v,idem:(await tx.select({v:count()}).from(schema.mcpWriteIdempotency))[0]!.v},before);
      throw new Rollback();
    }),Rollback);
  } finally { await client.end(); }
});

test("real PostgreSQL keyset pagination consumes every row after the cursor", { skip: !RUN }, async () => {
  const client = postgres(url!, { max: 1, prepare: false, ssl: false });
  const db = drizzle(client, { schema });

  try {
    await assert.rejects(
      db.transaction(async (tx) => {
        const owner = randomUUID();

        await tx.insert(schema.users).values({
          id: owner,
          email: `pagination-${owner}@example.invalid`,
          displayName: "Pagination Owner",
          status: "active",
        });

        await tx.insert(schema.userSettings).values({
          userId: owner,
          timezone: "Asia/Shanghai",
        });

        const baseTime = Date.parse("2026-08-01T12:00:00.000Z");
        const records = Array.from({ length: 7 }, (_, index) => ({
          id: randomUUID(),
          userId: owner,
          category: "project" as const,
          key: `分页记录 ${index + 1}`,
          content: `分页词 内容 ${index + 1}`,
          tags: ["pagination"],
          visibility: "assistant" as const,
          source: "web" as const,
          status: "active" as const,
          updatedAt: new Date(baseTime - index * 60_000),
        }));

        await tx.insert(schema.coreMemories).values(records);

        const service = new GlobalSearchService(
          new DrizzleGlobalSearchRepository(tx as never),
        );

        const complete = await service.search({
          userId: owner,
          query: "分页词",
          modules: ["memory"],
          scope: "active",
          limit: 25,
        });

        assert.equal(complete.results.length, 7);

        const pagedIds: string[] = [];
        let cursor: string | undefined;

        do {
          const page = await service.search({
            userId: owner,
            query: "分页词",
            modules: ["memory"],
            scope: "active",
            limit: 2,
            cursor,
          });

          pagedIds.push(...page.results.map((result) => result.entity_id));
          cursor = page.metadata.next_cursor ?? undefined;
        } while (cursor);

        assert.deepEqual(
          pagedIds,
          complete.results.map((result) => result.entity_id),
        );
        assert.equal(new Set(pagedIds).size, 7);

        throw new Rollback();
      }),
      Rollback,
    );
  } finally {
    await client.end();
  }
});

test("real PostgreSQL Universe search is owner-scoped, active-only, and empty before initialization", { skip: !RUN }, async () => {
  const client = postgres(url!, { max: 1, prepare: false, ssl: false });
  const db = drizzle(client, { schema });
  try {
    await assert.rejects(db.transaction(async (tx) => {
      const owner = randomUUID();
      const other = randomUUID();
      const now = new Date("2026-08-10T12:00:00.000Z");
      await tx.insert(schema.users).values([
        { id: owner, email: `universe-search-${owner}@example.invalid`, displayName: "Universe owner", status: "active" },
        { id: other, email: `universe-search-${other}@example.invalid`, displayName: "Other owner", status: "active" },
      ]);
      await tx.insert(schema.userSettings).values([
        { userId: owner, timezone: "Asia/Shanghai" },
        { userId: other, timezone: "Asia/Shanghai" },
      ]);
      const service = new GlobalSearchService(new DrizzleGlobalSearchRepository(tx as never));

      const beforeInitialization = await service.search({ userId: owner, query: "星球", modules: ["universe"], scope: "active", limit: 10 });
      assert.deepEqual(beforeInitialization.results, []);

      await tx.insert(schema.universeMeta).values({ userId: owner, name: "我的 Universe", schemaVersion: 2, createdAt: now, updatedAt: now, version: 0 });
      await tx.insert(schema.universeNodes).values([
        { userId: owner, id: "node-owner", title: "旅行星球", summary: "关于星球的摘要", content: "关于旅行的想法", type: "concept", tags: ["宇宙"], galaxies: [], galaxyMemberships: [], position: { x: 50, y: 50 }, createdAt: now, updatedAt: now, importance: "normal" },
        { userId: other, id: "node-other", title: "旅行星球", summary: "不应泄露", content: "其他用户", type: "concept", tags: [], galaxies: [], galaxyMemberships: [], position: { x: 20, y: 20 }, createdAt: now, updatedAt: now, importance: "normal" },
      ]);

      const active = await service.search({ userId: owner, query: "旅行", modules: ["universe"], scope: "active", limit: 10 });
      assert.equal(active.results.length, 1);
      assert.equal(active.results[0]?.entity_id, "node-owner");
      assert.equal(active.results[0]?.lifecycle_status, "active");
      assert.equal(active.results[0]?.detail_tool, "get_universe_node");
      assert.deepEqual(active.results[0]?.detail_arguments, { id: "node-owner" });
      const archived = await service.search({ userId: owner, query: "旅行", modules: ["universe"], scope: "archived", limit: 10 });
      assert.deepEqual(archived.results, []);
      throw new Rollback();
    }), Rollback);
  } finally {
    await client.end();
  }
});

test("real PostgreSQL pagination preserves sub-millisecond rows", { skip: !RUN }, async () => {
  const client = postgres(url!, { max: 1, prepare: false, ssl: false });
  const db = drizzle(client, { schema });

  try {
    await assert.rejects(
      db.transaction(async (tx) => {
        const owner = randomUUID();

        await tx.insert(schema.users).values({
          id: owner,
          email: `precision-${owner}@example.invalid`,
          displayName: "Precision Owner",
          status: "active",
        });

        await tx.insert(schema.userSettings).values({
          userId: owner,
          timezone: "Asia/Shanghai",
        });

        const ids = Array.from({ length: 4 }, () => randomUUID());

        await tx.insert(schema.coreMemories).values(
          ids.map((id, index) => ({
            id,
            userId: owner,
            category: "project" as const,
            key: `微秒分页 ${index + 1}`,
            content: `微秒分页 内容 ${index + 1}`,
            tags: ["precision"],
            visibility: "assistant" as const,
            source: "web" as const,
            status: "active" as const,
            updatedAt: new Date("2026-08-01T12:00:00.123Z"),
          })),
        );

        const instants = [
          "2026-08-01T12:00:00.123900Z",
          "2026-08-01T12:00:00.123800Z",
          "2026-08-01T12:00:00.123700Z",
          "2026-08-01T12:00:00.123600Z",
        ];

        for (const [index, id] of ids.entries()) {
          await tx.execute(sql`
            update core_memories
            set updated_at = ${instants[index]}::timestamptz
            where id = ${id}::uuid
          `);
        }

        const service = new GlobalSearchService(
          new DrizzleGlobalSearchRepository(tx as never),
        );

        const complete = await service.search({
          userId: owner,
          query: "微秒分页",
          modules: ["memory"],
          scope: "active",
          limit: 25,
        });

        assert.equal(complete.results.length, 4);

        const pagedIds: string[] = [];
        let cursor: string | undefined;
        let pageCount = 0;

        do {
          pageCount += 1;
          assert.ok(pageCount <= 10, "pagination did not terminate");

          const page = await service.search({
            userId: owner,
            query: "微秒分页",
            modules: ["memory"],
            scope: "active",
            limit: 1,
            cursor,
          });

          pagedIds.push(...page.results.map((result) => result.entity_id));
          cursor = page.metadata.next_cursor ?? undefined;
        } while (cursor);

        assert.deepEqual(
          pagedIds,
          complete.results.map((result) => result.entity_id),
        );
        assert.equal(new Set(pagedIds).size, 4);

        throw new Rollback();
      }),
      Rollback,
    );
  } finally {
    await client.end();
  }
});
