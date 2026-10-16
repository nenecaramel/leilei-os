import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { readAgentSdkTaskOutput } from '../src/agent-sdk-task-output.mjs';

test('pinned real SDK carries task output control without user input or a model process', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sdk-task-output-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const worker = join(root, 'synthetic-cli.mjs'), log = join(root, 'controls.jsonl');
  await writeFile(worker, `import readline from 'node:readline';
import {appendFileSync} from 'node:fs';
for await(const line of readline.createInterface({input:process.stdin})) {
 const m=JSON.parse(line);
 if(m.type==='user')throw new Error('No user/model input permitted');
 if(m.type!=='control_request')continue;
 appendFileSync(${JSON.stringify(log)},JSON.stringify(m.request)+'\\n');
 const response=m.request.subtype==='initialize'?{commands:[],models:[],agents:[],output_style:'default',available_output_styles:[]}:m.request.subtype==='get_task_output'?{output:'synthetic stdout',total_bytes:16,truncated:false}:{};
 process.stdout.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:m.request_id,response}})+'\\n');
}`);
  let end; const ended = new Promise(resolve => { end = resolve; });
  async function* inputs() { await ended; }
  const sdk = query({ prompt: inputs(), options: { pathToClaudeCodeExecutable: worker, cwd: root, settingSources: [], persistSession: false,
    env: { ...process.env, ANTHROPIC_API_KEY: '', CLAUDE_CONFIG_DIR: root, DISABLE_TELEMETRY: '1' } } });
  t.after(() => { end(); sdk.close(); });
  const result = await readAgentSdkTaskOutput(sdk, 'synthetic-task');
  assert.deepEqual(result, { output: 'synthetic stdout', totalBytes: 16, truncated: false });
  const controls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(controls.map(x => x.subtype), ['initialize', 'get_task_output']);
  assert.deepEqual(controls[1], { subtype: 'get_task_output', task_id: 'synthetic-task' });
});

test('task output timeout aborts the SDK control and never retries', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0, signal;
  const pending = readAgentSdkTaskOutput({request(_request, options){calls++; signal=options.signal; return new Promise(()=>{});}}, 'synthetic-task');
  const rejected = assert.rejects(pending, /timed out/);
  t.mock.timers.tick(2000); await rejected;
  assert.equal(calls, 1); assert.equal(signal.aborted, true);
});

test('pre-cancelled task output never sends a control', async () => {
  const controller = new AbortController(); controller.abort(); let calls=0;
  await assert.rejects(readAgentSdkTaskOutput({request(){calls++;}}, 'synthetic-task', controller.signal));
  assert.equal(calls, 0);
});

test('UTF-8 tail boundaries retain bounded Chinese output instead of rejecting decoder replacement bytes', async () => {
  const bytes=Buffer.from('漢'.repeat(4000),'utf8');
  const output=bytes.subarray(-8192).toString('utf8');
  assert.ok(Buffer.byteLength(output,'utf8')>8192,'raw byte tail starts inside a UTF-8 character');
  const result=await readAgentSdkTaskOutput({request:async()=>({response:{output,total_bytes:bytes.length,truncated:true}})},'synthetic-task');
  assert.ok(Buffer.byteLength(result.output,'utf8')<=8192);assert.ok(result.output.endsWith('漢'));assert.equal(result.totalBytes,12000);assert.equal(result.truncated,true);
});
