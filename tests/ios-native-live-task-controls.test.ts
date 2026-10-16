import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

test("actual Swift task DTO decodes SDK status and never mistakes stop acknowledgement for completion",{skip:process.platform!=="darwin"},()=>{
 const dir=mkdtempSync(join(tmpdir(),"leileios-task-swift-"));
 try{
  writeFileSync(join(dir,"main.swift"),`import Foundation
let data = #"{"generationId":"g","tasks":[{"taskId":"shell","handle":"opaque","active":true,"status":"paused","stopStatus":null,"description":"Synthetic task","summary":null}]}"#.data(using:.utf8)!
let receipt=try JSONDecoder().decode(NativeLiveTaskReceipt.self,from:data)
precondition(receipt.generationId=="g" && receipt.tasks!.count==1)
precondition(receipt.tasks![0].canStop && receipt.tasks![0].statusLabel=="Paused")
for status in ["requested","unknown"] {
 let task=try JSONDecoder().decode(NativeLiveTaskSnapshot.self,from:#"{"taskId":"shell","handle":"opaque","active":true,"status":"running","stopStatus":"STATUS","description":null,"summary":null}"#.replacingOccurrences(of:"STATUS",with:status).data(using:.utf8)!)
 precondition(!task.canStop)
 precondition(task.statusLabel==(status=="requested" ? "Stop requested":"Unavailable"))
}
for status in ["completed","failed","stopped","killed"] {
 let task=try JSONDecoder().decode(NativeLiveTaskSnapshot.self,from:#"{"taskId":"shell","handle":"opaque","active":true,"status":"STATUS","stopStatus":null,"description":null,"summary":null}"#.replacingOccurrences(of:"STATUS",with:status).data(using:.utf8)!)
 precondition(!task.canStop && task.title=="Task")
}
print("Task DTO behavior PASS")
`);
  const build=spawnSync("xcrun",["swiftc","-module-cache-path",join(dir,"cache"),"ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveTaskModels.swift",join(dir,"main.swift"),"-o",join(dir,"check")],{encoding:"utf8",timeout:120000});
  assert.equal(build.status,0,build.stderr);
  const run=spawnSync(join(dir,"check"),[],{encoding:"utf8",timeout:10000});assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/Task DTO behavior PASS/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("actual Swift task API polls the original request after a lost POST response",{skip:process.platform!=="darwin"},()=>{
 const dir=mkdtempSync(join(tmpdir(),"leileios-task-api-swift-"));
 try{
  writeFileSync(join(dir,"Checks.swift"),`import Foundation
@MainActor final class LeileiAPIClient {
 var posts=0;var reads=0;var controlID=""
 func request<T:Decodable & Sendable>(path:String,method:String="GET",body:Data?=nil,authenticated:Bool=false) async throws -> T {
  precondition(authenticated)
  if method=="POST" {
   posts+=1
   let object=try JSONSerialization.jsonObject(with:body!) as! [String:Any]
   controlID=object["control_id"] as! String
   precondition(object["kind"] as? String=="task")
   throw LeileiAPIError.invalidResponse
  }
  reads+=1;precondition(path.hasSuffix(controlID))
  let response:[String:Any]=["success":true,"data":["controlId":controlID,"prepareId":"source","kind":"task","payload":["action":"list"],"status":"applied","createdAt":"now","updatedAt":"now","receipt":["generationId":"generation","tasks":[]]]]
  return try JSONDecoder().decode(T.self,from:JSONSerialization.data(withJSONObject:response))
 }
}
enum LeileiAPIError:Error{case invalidResponse}
@main struct Checks {
 @MainActor static func main() async throws {
  let api=LeileiAPIClient();let receipt=try await api.nativeLiveTaskControl(prepareID:"source",action:"list")
  precondition(api.posts==1 && api.reads==1 && receipt.tasks!.isEmpty)
  print("Task API lost response PASS")
 }
}
`);
  const root="ios/LeileiOS/LeileiOS/Infrastructure/";
  const sources=["NativeLiveRuntimeModels.swift","API/NativeLive/NativeLiveModels.swift","API/NativeLive/NativeLiveInputMode.swift","API/NativeLive/NativeLiveAPIContracts.swift","API/NativeLive/NativeLiveTaskModels.swift","API/NativeLive/NativeLiveTaskAPI.swift"].map(s=>root+s);
  const build=spawnSync("xcrun",["swiftc","-parse-as-library","-module-cache-path",join(dir,"cache"),...sources,join(dir,"Checks.swift"),"-o",join(dir,"check")],{encoding:"utf8",timeout:120000});assert.equal(build.status,0,build.stderr);
  const run=spawnSync(join(dir,"check"),[],{encoding:"utf8",timeout:15000});assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/Task API lost response PASS/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
