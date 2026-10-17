import assert from "node:assert/strict";
import test from "node:test";
import { commitWakeResumeCursorLocked } from "../src/domains/bridge/turn/turn-repository/wake-resume-cursor.ts";
import type { PreparationRow, Transaction } from "../src/domains/bridge/turn/turn-repository/types.js";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const owner=id(9),sourceHead=id(10),sourceUser=id(11),queuedSend=id(12);
const session=id(13),base=id(14),advanced=id(15),conversation=id(16),user=id(17),checkpointRow=id(18);
const row={
  operation:"wake",runtimeMode:"resume",id:id(1),userId:user,conversationId:conversation,
  parentProviderSessionId:session,parentProviderCheckpointId:base,expectedWorkingDirectory:null,
  wakeContext:{epoch_id:sourceUser,source_head_message_id:sourceHead,source_user_message_id:sourceUser,
    runtime_generation:{presentation_owner_id:owner,source_revision:null}},
} as unknown as PreparationRow;

function exercise(responses:unknown[][]) {
  let index=0;
  const tx={async execute(_query:unknown) {
    assert.ok(index<responses.length,"unexpected database query after stale-fence");
    return responses[index++]!;
  }} as unknown as Transaction;
  return {tx,calls:()=>index};
}
const input={
  providerSessionId:row.parentProviderSessionId!,
  providerCheckpointId:advanced,
  effectiveWorkingDirectory:row.expectedWorkingDirectory,
};

test("cursor test fixture satisfies all native identity and generation guards",()=>{
  assert.equal(row.operation,"wake");
  assert.equal(row.runtimeMode,"resume");
  assert.equal(input.providerSessionId,row.parentProviderSessionId);
  assert.equal(input.effectiveWorkingDirectory,row.expectedWorkingDirectory);
  assert.match(input.providerCheckpointId,/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
  const w=row.wakeContext as Record<string,unknown>;
  assert.ok(w);
  assert.equal(w.epoch_id,w.source_user_message_id);
  assert.equal(typeof w.source_head_message_id,"string");
  assert.equal(typeof w.source_user_message_id,"string");
  const generation=w.runtime_generation as Record<string,unknown>;
  assert.ok(Object.hasOwn(generation,"presentation_owner_id"));
  assert.ok(Object.hasOwn(generation,"source_revision"));
  assert.equal(typeof generation.presentation_owner_id,"string");
  assert.equal(generation.source_revision,null);
});

test("stale Wake whose canonical head changed cannot graft any native cursor onto another branch",async()=>{
  const f=exercise([[{head:id(22),owner,revision:null}]]);
  assert.equal(await commitWakeResumeCursorLocked(f.tx,row,input),"stale");
  assert.equal(f.calls(),1,"no cursor write");
});

test("stale Wake with a started foreground must not overwrite its native execution cursor",async()=>{
  const f=exercise([
    [{head:sourceHead,owner,revision:null}],
    [{active:true,replacing:false,pending:true}],
  ]);
  assert.equal(await commitWakeResumeCursorLocked(f.tx,row,input),"stale");
  assert.equal(f.calls(),2);
});

test("quiet or visible Wake retains new native cursor when original source is still current",async()=>{
  const f=exercise([
    [{head:sourceHead,owner,revision:null}],
    [{active:false,replacing:false,pending:false}],
    [{id:checkpointRow,base}],
    [],
    [{id:sourceUser}],
  ]);
  assert.equal(await commitWakeResumeCursorLocked(f.tx,row,input),"current");
  assert.equal(f.calls(),5);
});

test("a new queued user input receives Wake's advanced cursor in the same transaction",async()=>{
  const f=exercise([
    [{head:sourceHead,owner:queuedSend,revision:null}],
    [{active:false,replacing:false,pending:true}],
    [{id:queuedSend}],
    [{id:checkpointRow,base}],
    [],
    [{id:queuedSend}],
    [{id:id(24)}],
  ]);
  assert.equal(await commitWakeResumeCursorLocked(f.tx,row,input),"superseded");
  assert.equal(f.calls(),7,"both checkpoint and pending send are updated");
});

test("a reserved or already-started successor may not be retargeted",async()=>{
  const f=exercise([
    [{head:sourceHead,owner:queuedSend,revision:null}],
    [{active:false,replacing:false,pending:true}],
    [],
  ]);
  assert.equal(await commitWakeResumeCursorLocked(f.tx,row,input),"stale");
  assert.equal(f.calls(),3);
});

test("native SID, checkpoint format and source generation must match before any DB mutation",async()=>{
  const invalid=[
    {...input,providerSessionId:id(200)},
    {...input,providerCheckpointId:"invalid"},
    {...input,effectiveWorkingDirectory:"/wrong"},
  ];
  for(const candidate of invalid){
    const f=exercise([]);
    assert.equal(await commitWakeResumeCursorLocked(f.tx,row,candidate),"stale");
    assert.equal(f.calls(),0);
  }
});
