import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {query} from '@anthropic-ai/claude-agent-sdk';
import {AgentSdkClaudeTransport} from '../src/agent-sdk-claude-transport.mjs';

// Pinned real CLI + isolated config + local fake model. A native Cron is created
// BEFORE a later message is retried in a fork. No second CronCreate is allowed.
test('an earlier native Cron survives edit/retry fork without duplication', {
  skip: process.env.RUN_NATIVE_CLI_OFFLINE_CRON_CARRY_TEST !== '1'
    && 'Set RUN_NATIVE_CLI_OFFLINE_CRON_CARRY_TEST=1 (zero external model calls)',
  timeout: 125_000,
},async()=>{
  const root=await mkdtemp(join(tmpdir(),'native-cron-carry-'));
  const abort=new AbortController();
  const timer=setTimeout(()=>abort.abort(),105_000);
  const at=new Date(Date.now()+3*60*60_000);
  const cron=at.getUTCMinutes()+' '+at.getUTCHours()+' * * *';
  const counts=[],errors=[];
  let requests=0,source,child;
  const server=createServer(async(req,res)=>{
    for await(const _ of req) { /* no transcript capture */ }
    res.setHeader('content-type','application/json');
    if(req.url?.includes('count_tokens')){res.end('{"input_tokens":20}');return;}
    if(!req.url?.includes('/messages')){res.end('{}');return;}
    const step=++requests;
    if(step>6){res.writeHead(500);res.end('unexpected synthetic request');return;}
    const tool=step===1?'CronCreate':step===4?'CronList':null;
    const input=step===1?{cron,prompt:'Synthetic inherited native task',recurring:true}:{};
    const value=step===2?'CRON_SET':step===3?'NEXT_CHAT_COMPLETE':'FORK_LISTED';
    const events=[
      {type:'message_start',message:{id:'msg_carry_'+step,type:'message',role:'assistant',
        model:'claude-sonnet-4-6',content:[],stop_reason:null,stop_sequence:null,
        usage:{input_tokens:20,output_tokens:0}}},
      {type:'content_block_start',index:0,content_block:tool?
        {type:'tool_use',id:'toolu_carry_'+step,name:tool,input:{}}:{type:'text',text:''}},
      {type:'content_block_delta',index:0,delta:tool?
        {type:'input_json_delta',partial_json:JSON.stringify(input)}:{type:'text_delta',text:value}},
      {type:'content_block_stop',index:0},
      {type:'message_delta',delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},
        usage:{output_tokens:20}},
      {type:'message_stop'},
    ];
    res.writeHead(200,{'content-type':'text/event-stream'});
    for(const e of events)res.write('event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n');
    res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const environment={...process.env,CLAUDE_CONFIG_DIR:root,
    ANTHROPIC_API_KEY:'synthetic-offline-key',
    ANTHROPIC_BASE_URL:'http://127.0.0.1:'+server.address().port,
    ANTHROPIC_AUTH_TOKEN:'',CLAUDE_CODE_OAUTH_TOKEN:'',
    ANTHROPIC_CUSTOM_HEADERS:'',CLAUDE_CODE_USE_BEDROCK:'0',
    CLAUDE_CODE_USE_VERTEX:'0',CLAUDE_CODE_USE_FOUNDRY:'0',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',
    DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1',
    HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',NO_PROXY:'127.0.0.1',TZ:'UTC'};
  // SDK's global session listing/import helpers do not receive the query's
  // isolated env. Read the REAL CLI-written JSONL directly instead; this
  // keeps the local checkpoint materializer and native CLI fork unmocked.
  const readRealEntries=async sessionId=>{
    const dirs=await readdir(join(root,'projects'),{withFileTypes:true});
    const matches=[];
    for(const dir of dirs){
      if(!dir.isDirectory())continue;
      try{
        const raw=await readFile(join(root,'projects',dir.name,sessionId+'.jsonl'),'utf8');
        matches.push(raw.trim().split('\\n').filter(Boolean).map(JSON.parse));
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }
    assert.equal(matches.length,1,'source CLI must persist exactly one session JSONL');
    return matches[0];
  };
  const createTransport=()=>new AgentSdkClaudeTransport({
    cwd:root,environment:{CLAUDE_CONFIG_DIR:root},toolPermissionPolicy:'auto_allow',
    createSendFileMcpServerImpl:async()=>null,
    sessionMessagesImpl:async id=>(await readRealEntries(id)).slice(0,1),
    importSessionToStoreImpl:async (id,store)=>store.append({subpath:null},await readRealEntries(id)),
    queryImpl:({prompt,options})=>query({prompt,options:{
      ...options,env:environment,settingSources:[],mcpServers:{},
      tools:['CronCreate','CronList','CronDelete'],persistSession:true,
      abortController:abort,systemPrompt:'Synthetic protocol fixture.'}}),
  });
  const handlers={authorize:async()=>true,
    onBackgroundResult:async()=>{throw Error('Future Cron fired unexpectedly');}};
  const observe=e=>{
    if(e.type!=='user')return;
    if(Array.isArray(e.tool_use_result?.jobs))counts.push(e.tool_use_result.jobs.length);
    for(const block of e.message?.content??[])
      if(block.type==='tool_result'&&block.is_error)errors.push(true);
  };
  try{
    source=await createTransport().openPersistentSession(handlers);
    source.events.on('event',observe);
    const created=await source.submit('Create native recurring Cron',{
      id:'11111111-1111-4111-8111-111111111111',source:'human'});
    assert.equal(created.result.subtype,'success');
    assert.equal(requests,2);
    const ordinary=await source.submit('Ordinary message after Cron',{
      id:'22222222-2222-4222-8222-222222222222',source:'human'});
    assert.equal(ordinary.result.subtype,'success');
    assert.equal(requests,3);
    const sourceId=source.sessionId;
    const checkpoint=await source.verifyCheckpoint({events:ordinary.events,parentCheckpointId:null});
    await source.close();

    // Critically: do not stub prepareLocalCheckpointForkImpl. The actual
    // LeileiOS historical transcript prefix and native CLI fork are exercised.
    child=await createTransport().forkPersistentSession({sessionId:sourceId,checkpointId:checkpoint},handlers);
    child.events.on('event',observe);
    const result=await child.submit('Retry the later message and list existing schedules',{
      id:'33333333-3333-4333-8333-333333333333',source:'human'});
    assert.equal(result.result.subtype,'success');
    assert.notEqual(child.sessionId,sourceId);
    assert.equal(requests,5,'fork must use CronList, not CronCreate');
    assert.deepEqual(errors,[]);
    assert.deepEqual(counts,[1],'exactly one original Cron survives the fork');
    assert.equal(child.state,'idle');
  }catch(error){
    console.error('native-cron-carry-diag',JSON.stringify({
      requests,counts,toolErrors:errors.length,
      sourceState:source?.state??'none',forkState:child?.state??'none'}));
    throw error;
  }finally{
    clearTimeout(timer);
    await child?.close().catch(()=>{});
    await source?.close().catch(()=>{});
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    await rm(root,{recursive:true,force:true});
  }
});
