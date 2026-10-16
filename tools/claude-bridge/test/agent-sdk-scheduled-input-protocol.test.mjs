import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { AgentSdkClaudeTransport } from '../src/agent-sdk-claude-transport.mjs';

test('pinned SDK transports native loop input and scheduled hook verdict into the existing background sink', {timeout:10_000}, async t => {
 const root=await mkdtemp(join(tmpdir(),'sdk-scheduled-protocol-'));t.after(async()=>{
  if(t.signal.aborted)t.diagnostic(await readFile(log,'utf8').catch(()=> 'no protocol log'));
  await rm(root,{recursive:true,force:true});
 });
 const worker=join(root,'synthetic-cli.mjs'),log=join(root,'metadata.jsonl');
 await writeFile(worker,`import readline from 'node:readline';
import {appendFileSync} from 'node:fs';
let hook;
const emit=m=>process.stdout.write(JSON.stringify(m)+'\\n');
const note=m=>appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+'\\n');
for await(const line of readline.createInterface({input:process.stdin})){
 const m=JSON.parse(line);
 if(m.type==='control_request'){
  if(m.request.subtype==='initialize'){
   hook=m.request.hooks.UserPromptSubmit[0].hookCallbackIds[0];
   note({verbatim:m.request.verbatimPrompts});
  }
  emit({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:m.request.subtype==='initialize'?{commands:[],models:[],agents:[],output_style:'default',available_output_styles:[]}:{} }});
 }else if(m.type==='user'){
  note({client_composed:m.client_composed,origin:m.origin.kind});
  emit({type:'system',subtype:'init',session_id:'synthetic-session'});
  emit({type:'assistant',session_id:'synthetic-session',message:{role:'assistant',content:[{type:'text',text:'synthetic'}]}});
  emit({type:'result',subtype:'success',session_id:'synthetic-session',user_message_uuid:m.uuid});
  emit({type:'control_request',request_id:'scheduled-hook',request:{subtype:'hook_callback',callback_id:hook,input:{hook_event_name:'UserPromptSubmit',session_id:'synthetic-session',transcript_path:'unused',cwd:${JSON.stringify(root)},source:'schedule_wakeup',prompt_id:'scheduled-one',prompt:'synthetic'}}});
 }else if(m.type==='control_response'&&m.response.request_id==='scheduled-hook'){
  note({hookResponse:m.response});
  if(m.response.response.decision==='block')continue;
  emit({type:'assistant',session_id:'synthetic-session',message:{role:'assistant',content:[{type:'text',text:'synthetic scheduled response'}]}});
  emit({type:'result',subtype:'success',session_id:'synthetic-session',user_message_uuid:'scheduled-native'});
 }
}
`);
 let delivered;const background=new Promise(resolve=>{delivered=resolve;});const admissions=[];
 const transport=new AgentSdkClaudeTransport({environment:{},cwd:root,createSendFileMcpServerImpl:async()=>null,
  queryImpl:({prompt,options})=>query({prompt,options:{...options,pathToClaudeCodeExecutable:worker,settingSources:[],persistSession:false,
    env:{...process.env,ANTHROPIC_API_KEY:'',CLAUDE_CONFIG_DIR:root,DISABLE_TELEMETRY:'1'}}})});
 const host=await transport.openPersistentSession({authorize:async ctx=>{admissions.push(ctx.phase);return true;},onBackgroundResult:async frame=>delivered(frame)});
 t.after(()=>host.close());
 const foreground=await host.submit('/loop 5m synthetic',{source:'human',id:'human-command'});
 const frame=await background;
 assert.equal(foreground.inputId,'human-command');assert.equal(frame.result.user_message_uuid,'scheduled-native');
 assert.deepEqual(admissions,['input','scheduled']);
 const metadata=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
 assert.deepEqual(metadata.find(row=>row.origin),{origin:'human'});
 assert.equal(metadata.find(row=>row.hookResponse).hookResponse.subtype,'success');
 assert.notEqual(metadata.find(row=>row.hookResponse).hookResponse.response.decision,'block');
});
