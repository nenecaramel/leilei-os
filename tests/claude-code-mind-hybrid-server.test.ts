import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { startClaudeCodeMindHybridServer } from "../src/domains/runtime/mind/claude-code-mind-hybrid-server.js";

const ID = "11111111-1111-4111-8111-111111111111";
function post(socketPath: string, route: string, body: unknown): Promise<{status: number; body: string}> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({socketPath,path:route,method:"POST",
      headers:{"content-type":"application/json"}}, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({
        status:response.statusCode ?? 0,
        body:Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error",reject);
    request.end(JSON.stringify(body));
  });
}

test("Claude Mind scorer accepts only bounded local candidates and verified IDs",async t=>{
  const home = await mkdtemp(join(tmpdir(),"claude-only-mind-"));
  t.after(async()=>rm(home,{recursive:true,force:true}));
  const socket = join(home,"hybrid.sock");
  let calls = 0;
  const stop = await startClaudeCodeMindHybridServer({
    scoreCandidatesHybrid:async({candidates})=>{
      calls++;
      return {selectedIds:candidates.map(c=>c.stateId)};
    },
  },socket);
  t.after(stop);
  const input={query:"用户的记忆",candidates:[{stateId:ID,kind:"memory",text:"真实记录"}]};
  assert.deepEqual(await post(socket,"/score-hybrid",input),{
    status:200,body:JSON.stringify({selected_ids:[ID]}),
  });
  assert.equal((await post(socket,"/search-hybrid",input)).status,404);
  assert.equal((await post(socket,"/score-hybrid",{...input,candidates:[...input.candidates,...input.candidates]})).status,503);
  assert.equal((await post(socket,"/score-hybrid",{...input,candidates:[]})).status,503);
  assert.equal((await post(socket,"/score-hybrid",{...input,candidates:Array.from({length:257},(_,i)=>({
    stateId:`00000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`,kind:"memory",text:"文本"
  }))})).status,503);
  assert.equal(calls,1);
});

test("Claude Mind socket rejects selections not contained in candidate request",async t=>{
  const home = await mkdtemp(join(tmpdir(),"claude-only-mind-"));
  t.after(async()=>rm(home,{recursive:true,force:true}));
  const socket = join(home,"hybrid.sock");
  const stop = await startClaudeCodeMindHybridServer({
    scoreCandidatesHybrid:async()=>({selectedIds:["22222222-2222-4222-8222-222222222222"]}),
  },socket);
  t.after(stop);
  const result=await post(socket,"/score-hybrid",{
    query:"记忆",candidates:[{stateId:ID,kind:"memory",text:"真实记录"}],
  });
  assert.equal(result.status,503);
  assert.equal(result.body,"");
});
