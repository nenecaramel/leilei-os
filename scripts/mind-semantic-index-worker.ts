/**
 * Run as a separate Railway worker after migrations and E5 preparation:
 *   pnpm exec tsx scripts/mind-semantic-index-worker.ts
 * One startup backlog drain, then PostgreSQL LISTEN/NOTIFY on Memory writes.
 * It never calls the Mac, the Hook, or any HTTP recall endpoint.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { ClaudeCodeRailwayE5 } from "../src/domains/runtime/mind/claude-code-railway-e5.js";
import { mindLshBands } from "../src/domains/runtime/mind/claude-code-semantic-lsh.js";

type Job = {stateId:string;userId:string;subjectId:string;revision:number;text:string};
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL_REQUIRED");
const db = createDatabase(url);
const listener = postgres(url,{max:1,prepare:false,ssl:"require",connect_timeout:3});
const embedder = new ClaudeCodeRailwayE5();
let draining = false;
let again = false;
let stopping = false;
let embeddingServer: Server | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;

const hashText = (text:string) => createHash("sha256").update(text).digest("hex");

async function claim():Promise<Job[]> {
  // Leases allow recovery after worker crashes without holding model-time locks.
  const result=await db.db.execute(sql<Job>`
    WITH picked AS (
      SELECT state_id FROM runtime_mind_recall_semantic_dirty
      WHERE claimed_at IS NULL OR claimed_at < now()-interval '5 minutes'
      ORDER BY queued_at, state_id LIMIT 8 FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE runtime_mind_recall_semantic_dirty j
      SET claimed_at=now()
      FROM picked
      WHERE j.state_id=picked.state_id
      RETURNING j.state_id, j.user_id, j.subject_id, j.revision
    )
    SELECT c.state_id AS "stateId", c.user_id AS "userId",
      c.subject_id AS "subjectId", c.revision, m.text
    FROM claimed c JOIN runtime_subject_states m ON m.id=c.state_id
  `);
  return [...result];
}

async function commit(job:Job,buckets:number[]):Promise<void>{
  await db.db.transaction(async tx=>{
    // Row lock serializes with Memory edits. Their SQL trigger removes old
    // buckets atomically, so hidden/deleted revisions are never restored.
    const current=await tx.execute(sql<{text:string;userId:string;subjectId:string}>`
      SELECT text, user_id AS "userId", subject_id AS "subjectId"
      FROM runtime_subject_states WHERE id=${job.stateId}::uuid FOR SHARE
    `);
    const queue=await tx.execute(sql<{revision:number}>`
      SELECT revision FROM runtime_mind_recall_semantic_dirty
      WHERE state_id=${job.stateId}::uuid FOR UPDATE
    `);
    if(current.length!==1 || queue.length!==1 ||
       Number(queue[0]!.revision)!==Number(job.revision) ||
       current[0]!.text!==job.text ||
       current[0]!.userId!==job.userId ||
       current[0]!.subjectId!==job.subjectId) return;
    await tx.execute(sql`DELETE FROM runtime_mind_recall_semantic_bands
      WHERE state_id=${job.stateId}::uuid`);
    const digest=hashText(job.text);
    const rows=buckets.map((bucket,band)=>sql`(
      ${job.stateId}::uuid,${job.userId}::uuid,${job.subjectId},
      ${band},${bucket},${digest}
    )`);
    await tx.execute(sql`INSERT INTO runtime_mind_recall_semantic_bands
      (state_id,user_id,subject_id,band,bucket,content_sha256)
      VALUES ${sql.join(rows,sql`,`)}`);
    await tx.execute(sql`DELETE FROM runtime_mind_recall_semantic_dirty
      WHERE state_id=${job.stateId}::uuid AND revision=${job.revision}`);
  });
}

async function drain():Promise<void>{
  if(draining){again=true;return;}
  draining=true;
  try{
    do{
      again=false;
      for(;;){
        if(stopping)return;
        const jobs=await claim();
        if(jobs.length===0)break;
        for(const job of jobs){
          const [vector]=await embedder.embedPassages([job.text.slice(0,2_000)]);
          await commit(job,mindLshBands(vector!));
        }
      }
    }while(again);
  }finally{draining=false;}
}

async function startPrivateQueryEmbedding(): Promise<Server> {
  const secret=process.env.LEILEI_MIND_E5_TOKEN;
  if(!secret || secret.length<32)throw new Error("MIND_PRIVATE_E5_TOKEN_REQUIRED");
  const expected=Buffer.from(`Bearer ${secret}`);
  const server=createServer(async(request,response)=>{
    if(request.method==="GET" && request.url==="/ready"){
      response.writeHead(200).end("ready");
      return;
    }
    if(request.method!=="POST" || request.url!=="/embed-query"){
      response.writeHead(404).end();return;
    }
    const provided=Buffer.from(request.headers.authorization??"");
    if(provided.length!==expected.length || !timingSafeEqual(provided,expected)){
      response.writeHead(401).end();return;
    }
    try{
      const chunks:Buffer[]=[];let size=0;
      for await(const part of request){
        size+=part.length;
        if(size>2048)throw new Error("Oversized query");
        chunks.push(part);
      }
      const data:unknown=JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if(!data || typeof data!=="object" || !("query" in data) ||
        typeof data.query!=="string" || !data.query.trim() || data.query.length>512)
        throw new Error("Invalid query");
      const vector=await embedder.embedQuery(data.query);
      if(!response.destroyed){
        response.setHeader("Cache-Control","no-store");
        response.setHeader("Content-Type","application/json");
        response.end(JSON.stringify({vector}));
      }
    }catch{if(!response.destroyed)response.writeHead(503).end();}
  });
  server.requestTimeout=2000;
  server.headersTimeout=2000;
  await new Promise<void>((resolve,reject)=>{
    server.once("error",reject);
    server.listen(Number(process.env.PORT??3000),"0.0.0.0",resolve);
  });
  return server;
}

function scheduleDrain():void {
  if(stopping)return;
  void drain().catch(()=>{
    process.stderr.write("MIND_SEMANTIC_INDEX_RETRY_REQUIRED\\n");
    if(retry)clearTimeout(retry);
    retry=setTimeout(()=>{retry=null;scheduleDrain();},5*60_000);
  });
}

async function main():Promise<void>{
  await embedder.warmup();
  embeddingServer=await startPrivateQueryEmbedding();
  // On every LISTEN (re)connection, sweep unprocessed rows in case a
  // database notification occurred while this worker was disconnected.
  await listener.listen("leilei_mind_semantic_dirty",scheduleDrain,scheduleDrain);
  const shutdown=()=>{
    stopping=true;
    if(retry)clearTimeout(retry);
    embeddingServer?.close();
    void listener.end().then(()=>db.close()).then(()=>{
      process.exit(0);
    }).catch(()=>{process.exitCode=1;});
  };
  process.once("SIGTERM",shutdown);
  process.once("SIGINT",shutdown);
  await drain();
  process.stdout.write("mind_semantic_index_worker_ready\n");
}
await main().catch(async()=>{
  process.stderr.write("MIND_SEMANTIC_INDEX_WORKER_UNAVAILABLE\n");
  embeddingServer?.close();
  await listener.end().catch(()=>undefined);
  await db.close().catch(()=>undefined);
  process.exitCode=1;
});
