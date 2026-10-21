import assert from "node:assert/strict";
import test from "node:test";
import { createNativeLiveRelayInternalRouter } from "../src/web-api/native-live-internal/router.js";
import { withServer, FakeRelayService, userId, listenerId, prepareId } from "./helpers/native-live-http-relay-fixtures.js";
const generationId = "77777777-7777-4777-8777-777777777777";
const body = () => ({ listener_instance_id: listenerId, provider_session_id: "synthetic-session", generation_id: generationId, snapshot_sequence: 1,
 tasks: [{ task_id: "cron", run_id: "run", task_type: "cron", description: "synthetic", ambient: true }] });
test("task-state authenticated strict HTTP channel forwards validated membership and advertises support", async () => {
 const received: unknown[] = [];
 await withServer(app => {
  app.use((req,_res,next) => { if(req.header("x-test-owner") === "yes") req.mcpUserId = userId; next(); });
  app.use(createNativeLiveRelayInternalRouter({ relayService: new FakeRelayService(), runtimeControlService: {
   async waitNextForListener(){return {outcome:"timeout"};}, async completeForListener(){return "applied";},
   async waitTaskForListener(){return {outcome:"timeout"};}, async checkTaskAdmission(){return true;},
   async publishTaskState(input: unknown){received.push(input); return {outcome:"created"};},
  } as never }));
 }, async base => {
  const post = (path: string, payload: unknown, auth = true) => fetch(`${base}${path}`, { method:"POST", headers:{"content-type":"application/json", ...(auth ? {"x-test-owner":"yes"} : {})}, body:JSON.stringify(payload) });
  const path = `/reservations/${prepareId}/task-state`;
  assert.equal((await post(path, body(), false)).status,401);
  const capability = await post("/task-controls/capabilities",{});
  assert.deepEqual((await capability.json() as any).data,{version:1,taskState:true});
  const response = await post(path,body()); assert.equal(response.status,200); assert.deepEqual((await response.json() as any).data,{outcome:"created"});
  assert.deepEqual(received,[{userId,prepareId,listenerInstanceId:listenerId,providerSessionId:"synthetic-session",generationId,snapshotSequence:1,tasks:body().tasks}]);
  for(const invalid of [{...body(),extra:true},{...body(),snapshot_sequence:0},{...body(),generation_id:"bad"},{...body(),tasks:Array(65).fill(body().tasks[0])},
   {...body(),tasks:[body().tasks[0],body().tasks[0]]},{...body(),tasks:[{...body().tasks[0],task_id:" "}]},{...body(),tasks:[{...body().tasks[0],output:"hidden"}]},
   {...body(),tasks:[{...body().tasks[0],ambient:"yes"}]}]) assert.equal((await post(path,invalid)).status,400);
  assert.equal(received.length,1,"invalid data never reaches persistence");
 });
});
