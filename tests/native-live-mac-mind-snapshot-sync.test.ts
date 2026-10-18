import assert from "node:assert/strict";
import test from "node:test";
import { MacMindSnapshotSync } from "../src/domains/bridge/mac/native-live-mac-mind-snapshot-sync.js";

const version = "a".repeat(64);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("Mac snapshot synchronizer uses authenticated pages and skips unchanged index", async () => {
  const calls: string[] = []; const applied: unknown[] = [];
  let ready = false;
  const request = (async (url: string | URL | Request, options?: RequestInit) => {
    calls.push(String(url));
    assert.equal(options?.headers && (options.headers as Record<string,string>).authorization, "Bearer private");
    const offset = Number(new URL(String(url)).searchParams.get("offset"));
    const rows = offset === 0 ? [{stateId:id(1),text:"我们以前的约定"}] :
      [{stateId:id(2),text:"我们过去的争执"}];
    return new Response(JSON.stringify({success:true,data:{
      version,total:2,memories:rows,next_offset:offset===0?1:null,
    }}),{status:200});
  }) as typeof fetch;
  const index = {
    isSnapshotReady: () => ready,
    replaceSnapshot: async (value: unknown) => { applied.push(value); ready = true; },
  };
  const sync = new MacMindSnapshotSync("https://example.invalid", "private", index, request);
  await sync.refresh();
  assert.equal(calls.length,2);
  assert.deepEqual(applied[0],{version,memories:[
    {stateId:id(1),text:"我们以前的约定"},{stateId:id(2),text:"我们过去的争执"},
  ]});
  await sync.refresh();
  assert.equal(calls.length,3);
  assert.equal(applied.length,1);
  ready=false;
  await sync.refresh();
  assert.equal(applied.length,2, "worker reset rebuilds the unchanged snapshot");
});

test("Mac snapshot synchronizer refuses a mixed-version page before indexing", async () => {
  let calls=0; let applied=0;
  const request = (async () => {
    calls++;
    return new Response(JSON.stringify({success:true,data:{
      version:calls===1?"a".repeat(64):"b".repeat(64),
      total:2,memories:[{stateId:id(calls),text:"test"}],
      next_offset:calls===1?1:null,
    }}),{status:200});
  }) as typeof fetch;
  const sync = new MacMindSnapshotSync("https://example.invalid", "private", {
    isSnapshotReady: () => false,replaceSnapshot:async()=>{applied++;},
  },request);
  await assert.rejects(sync.refresh(),/changed during sync/);
  assert.equal(applied,0);
});
