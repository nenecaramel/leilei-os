import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

test("actual Swift send encoder adds voice identity without changing ordinary wire shape", {skip:process.platform !== "darwin"}, () => {
  const source = readFileSync("ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveAPIContracts.swift", "utf8");
  const body = source.slice(source.indexOf("struct NativeLiveSendBody:"), source.indexOf("struct NativeLiveRetryBody:"));
  const mode = readFileSync("ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveInputMode.swift", "utf8");
  const dir=mkdtempSync(join(tmpdir(),"leileios-voice-encoder-"));
  try {
    writeFileSync(join(dir,"main.swift"), `${mode}\nstruct NativeLiveExecutionSelection: Encodable, Sendable {}\n${body}\nfor mode in [NativeLiveInputMode.text, .voice] {\n let body = NativeLiveSendBody(dispatchTarget:"claude_code",requestId:"request",operation:"send",conversationId:"conversation",expectedHeadMessageId:nil,text:"我今天好累",attachmentIds:[],execution:nil,inputMode:mode)\n print(String(data:try JSONEncoder().encode(body),encoding:.utf8)!)\n}\n`);
    execFileSync("swiftc",[join(dir,"main.swift"),"-o",join(dir,"encode")]);
    const [text,voice]=execFileSync(join(dir,"encode"),{encoding:"utf8"}).trim().split("\n").map(line=>JSON.parse(line));
    assert.deepEqual(text,{dispatch_target:"claude_code",request_id:"request",operation:"send",conversation_id:"conversation",expected_head_message_id:null,text:"我今天好累"});
    assert.deepEqual(voice,{...text,input_mode:"voice"});
  } finally {rmSync(dir,{recursive:true,force:true});}
});
