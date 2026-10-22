import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { AgentSdkClaudeTransport } from '../src/agent-sdk-claude-transport.mjs';

// Real pinned CLI rewind + CronCreate + fully completed ordinary chat + idle fire.
// No account/model calls: every Anthropic response comes from a loopback server.
// Opt-in because this must cross a real native minute boundary.
test('native edit rewound in place preserves one-shot Cron across a later completed human turn', {
  skip: process.env.RUN_NATIVE_CLI_OFFLINE_EDIT_CRON_TEST !== '1'
    && 'Set RUN_NATIVE_CLI_OFFLINE_EDIT_CRON_TEST=1 (no external model calls)',
  timeout: 215_000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-edit-cron-offline-'));
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), 195_000);
  const target = new Date(Date.now() + 95_000);
  const cron = `${target.getUTCMinutes()} ${target.getUTCHours()} * * *`;
  let modelRequests = 0, hookCallbacks = 0, scheduledAdmissions = 0;
  let jobCounts = [], host, seedId = null, checkpointId = null;
  let resolveBackground;
  const background = new Promise(resolve => { resolveBackground = resolve; });

  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* No user text is ever logged. */ }
    response.setHeader('content-type', 'application/json');
    if (request.url?.includes('count_tokens')) { response.end('{"input_tokens":20}'); return; }
    if (!request.url?.includes('/messages')) { response.end('{}'); return; }
    const step = ++modelRequests;
    if (step > 8) { response.writeHead(500); response.end('unexpected synthetic request'); return; }
    const tool = step === 2 ? 'CronCreate' : step === 5 ? 'CronList' : null;
    const input = step === 2 ? {cron, prompt:'synthetic edited Cron', recurring:false} : {};
    const value = step === 1 ? 'SEED' : step === 3 ? 'SCHEDULED'
      : step === 4 ? 'ORDINARY_CHAT_OK' : 'TIMER_OK';
    response.writeHead(200, {'content-type':'text/event-stream'});
    const block = tool ? {type:'tool_use',id:`toolu_edit_${step}`,name:tool,input:{}}
      : {type:'text',text:''};
    for (const item of [
      {type:'message_start',message:{id:`msg_edit_${step}`,type:'message',role:'assistant',
        model:'claude-sonnet-4-6',content:[],stop_reason:null,stop_sequence:null,
        usage:{input_tokens:20,output_tokens:0}}},
      {type:'content_block_start',index:0,content_block:block},
      {type:'content_block_delta',index:0,delta:tool
        ? {type:'input_json_delta',partial_json:JSON.stringify(input)}
        : {type:'text_delta',text:value}},
      {type:'content_block_stop',index:0},
      {type:'message_delta',delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},
        usage:{output_tokens:20}},
      {type:'message_stop'},
    ]) response.write(`event: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`);
    response.end();
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const environment = {
    ...process.env,CLAUDE_CONFIG_DIR:root,ANTHROPIC_API_KEY:'synthetic-offline-key',
    ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,
    ANTHROPIC_AUTH_TOKEN:'',CLAUDE_CODE_OAUTH_TOKEN:'',ANTHROPIC_CUSTOM_HEADERS:'',
    CLAUDE_CODE_USE_BEDROCK:'0',CLAUDE_CODE_USE_VERTEX:'0',CLAUDE_CODE_USE_FOUNDRY:'0',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',
    // As in production: LeileiOS writes as the SDK, even from a Claude shell.
    CLAUDE_CODE_ENTRYPOINT:'sdk-ts',DISABLE_TELEMETRY:'1',
    DISABLE_ERROR_REPORTING:'1',HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',
    NO_PROXY:'127.0.0.1',TZ:'UTC',
  };
  try {
    const seed = query({prompt:'Isolated source checkpoint',options:{
      cwd:root,env:environment,settingSources:[],tools:[],mcpServers:{},
      persistSession:true,abortController:abort,
    }});
    for await (const item of seed) {
      if (item.type === 'system' && item.subtype === 'init') seedId = item.session_id;
      if (item.type === 'assistant' && !item.parent_tool_use_id && !item.isSidechain
        && typeof item.uuid === 'string') checkpointId = item.uuid;
    }
    assert.ok(seedId && checkpointId,'the seed must have a durable native session/checkpoint');
    assert.equal(modelRequests,1);

    const transport = new AgentSdkClaudeTransport({
      environment:{CLAUDE_CONFIG_DIR:root},cwd:root,toolPermissionPolicy:'auto_allow',
      createSendFileMcpServerImpl:async()=>null,
      // SDK session listing does not receive the isolated config dir.
      sessionMessagesImpl:async()=>[{}],
      importSessionToStoreImpl:async(_session,store)=>store.append({subpath:null},[
        {type:'user',uuid:'11111111-1111-4111-8111-111111111111',
          parentUuid:null,sessionId:seedId,message:{role:'user',content:[{type:'text',text:'synthetic'}]}},
        {type:'assistant',uuid:checkpointId,
          parentUuid:'11111111-1111-4111-8111-111111111111',
          sessionId:seedId,message:{role:'assistant',content:[{type:'text',text:'synthetic'}]}},
      ]),
      // The pinned CLI performs the ACTUAL rewind (resumeSessionAt on the same
      // session), scheduling, human continuation and fire.
      queryImpl:({prompt,options})=>query({prompt,options:{
        ...options,env:environment,settingSources:[],mcpServers:{},
        tools:['CronCreate','CronList','CronDelete'],persistSession:true,
        abortController:abort,hooks:{...options.hooks,UserPromptSubmit:[{hooks:[async input=>{
          hookCallbacks++;return options.hooks.UserPromptSubmit[0].hooks[0](input);
        }]}]},
      }}),
    });
    host = await transport.restorePersistentSession({sessionId:seedId,checkpointId,
      inputId:'22222222-2222-4222-8222-222222222222',source:'human',rewind:true},{
      authorize:async ctx=>{if(ctx.phase==='scheduled')scheduledAdmissions++;return true;},
      onBackgroundResult:async frame=>resolveBackground(frame),
    });
    const edit = await host.submit('Synthetic edited message that creates native Cron',{
      id:'22222222-2222-4222-8222-222222222222',source:'human',
    });
    assert.equal(edit.result.subtype,'success');
    assert.equal(modelRequests,3);
    const ordinary = await host.submit('An ordinary message after edited Cron',{
      id:'33333333-3333-4333-8333-333333333333',source:'human',
    });
    assert.equal(ordinary.result.subtype,'success');
    assert.equal(modelRequests,4);
    assert.equal(ordinary.providerSessionId,edit.providerSessionId,
      'the edited branch MUST keep one native SDK process after a normal chat');
    assert.equal(edit.providerSessionId,seedId,
      'the edit rewinds its own provider session in place');
    assert.equal(host.state,'idle');
    const frame = await Promise.race([
      background,
      host.completion.then(()=>{throw Error('rewound writer closed before native Cron');}),
      new Promise((_,reject)=>abort.signal.addEventListener('abort',()=>reject(Error('native Cron deadline expired')),{once:true})),
    ]);
    assert.equal(frame.result.subtype,'success');
    assert.equal(scheduledAdmissions,1);
    assert.equal(modelRequests,6);
    assert.equal(hookCallbacks,3);
    assert.equal(host.state,'idle');
  } catch (error) {
    console.error('native-edit-cron-offline-diag',JSON.stringify({
      modelRequests,hookCallbacks,scheduledAdmissions,
      hostState:host?.state??'not-open',jobCounts,
    }));
    throw error;
  } finally {
    clearTimeout(deadline);
    await host?.close().catch(()=>{});
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    await rm(root,{recursive:true,force:true});
  }
});
