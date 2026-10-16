import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { AgentSdkClaudeTransport } from '../src/agent-sdk-claude-transport.mjs';

// Actual pinned CLI, entirely local fake Anthropic responses. Opt in because a
// real minute-boundary timer would otherwise slow every bridge/gate invocation.
for (const mode of ['cron', 'loop']) test(`real native CLI ${mode === 'cron' ? 'creates, fires and removes one-shot Cron' : 'fires and stops native /loop ScheduleWakeup'} without hook source`, {
  skip: process.env.RUN_NATIVE_CLI_OFFLINE_CRON_TEST !== '1' && 'Set RUN_NATIVE_CLI_OFFLINE_CRON_TEST=1 (no real model calls)',
  timeout: 195_000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-cron-offline-'));
  const abort = new AbortController();
  // Native minute-boundary polling/jitter is real; bound the opt-in probe
  // without assuming a 60-second wall-clock delivery SLA.
  const deadline = setTimeout(() => abort.abort(), 180_000);
  const hooks = [], phases = [], jobCounts = [];
  let stopped = false;
  let requests = 0, toolErrors = 0, tools = [], host;
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    if (request.url?.includes('count_tokens')) {
      response.setHeader('content-type', 'application/json');
      response.end('{"input_tokens":20}'); return;
    }
    if (request.url?.includes('/messages')) {
      const body = JSON.parse(raw); // Only this test's isolated synthetic session.
      tools = body.tools?.map(tool => tool.name) ?? [];
      respond(response, ++requests, mode); return;
    }
    response.setHeader('content-type', 'application/json'); response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const environment = {
      ...process.env,
      CLAUDE_CONFIG_DIR: root, ANTHROPIC_API_KEY: 'synthetic-offline-key',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      ANTHROPIC_AUTH_TOKEN: '', CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_CUSTOM_HEADERS: '',
      CLAUDE_CODE_USE_BEDROCK: '0', CLAUDE_CODE_USE_VERTEX: '0', CLAUDE_CODE_USE_FOUNDRY: '0',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
      HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NO_PROXY: '127.0.0.1', TZ: 'UTC',
    };
    const transport = new AgentSdkClaudeTransport({
      environment: {}, cwd: root, toolPermissionPolicy: 'auto_allow',
      createSendFileMcpServerImpl: async () => null,
      queryImpl: ({ prompt, options }) => query({ prompt, options: {
        ...options, env: environment, settingSources: [], mcpServers: {},
        tools: ['CronCreate', 'CronList', 'CronDelete', 'ScheduleWakeup'], persistSession: false,
        abortController: abort, systemPrompt: 'Synthetic local protocol fixture.',
        hooks: { ...options.hooks, UserPromptSubmit: [{ hooks: [async input => {
          hooks.push({ hasSource: Object.hasOwn(input, 'source'), hasPromptId: Object.hasOwn(input, 'prompt_id') });
          return options.hooks.UserPromptSubmit[0].hooks[0](input);
        }] }] },
      } }),
    });
    let delivered;
    const background = new Promise(resolve => { delivered = resolve; });
    host = await transport.openPersistentSession({
      authorize: async context => { phases.push(context.phase); return true; },
      onBackgroundResult: async frame => delivered(frame),
    });
    host.events.on('event', event => {
      if (event.type !== 'user') return;
      if (event.tool_use_result?.stopped === true) stopped = true;
      if (Array.isArray(event.tool_use_result?.jobs)) jobCounts.push(event.tool_use_result.jobs.length);
      for (const block of event.message?.content ?? []) {
        if (block.type === 'tool_result' && block.is_error) toolErrors++;
      }
    });
    const foreground = await host.submit(mode === 'loop' ? '/loop 1m Synthetic timer check' : 'Synthetic native one-shot timer', {
      id: '11111111-1111-4111-8111-111111111111', source: 'human',
    });
    assert.equal(foreground.result.subtype, 'success');
    assert.equal(requests, 2, 'foreground completes before the timer fires');
    assert.equal(tools.includes(mode === 'cron' ? 'CronCreate' : 'ScheduleWakeup'), true);
    assert.equal(toolErrors, 0);
    const frame = await Promise.race([background, host.completion.then(() => {
      throw new Error('Native CLI closed before the one-shot result');
    })]);
    assert.equal(frame.result.subtype, 'success');
    assert.equal(requests, 4, 'one native fire plus native list/stop, using local responses only');
    if (mode === 'cron') assert.deepEqual(jobCounts, [0], 'native one-shot is automatically removed');
    else assert.equal(stopped, true, 'native dynamic loop stop is acknowledged');
    assert.equal(toolErrors, 0);
    assert.equal(phases.filter(phase => phase === 'scheduled').length, 1);
    assert.equal(phases.includes('tool'), true);
    assert.deepEqual(hooks, [
      { hasSource: false, hasPromptId: true },
      { hasSource: false, hasPromptId: true },
    ]);
    assert.equal(host.state, 'idle');
  } finally {
    clearTimeout(deadline);
    await host?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

function respond(response, step, mode) {
  const name = step === 1 || step === 3 ? (mode === 'loop' ? 'ScheduleWakeup' : step === 1 ? 'CronCreate' : 'CronList') : null;
  const input = mode === 'loop' ? (step === 1 ? { delaySeconds: 60, reason: 'Synthetic offline timer', prompt: '/loop 1m Synthetic timer check', noop: true } : { stop: true }) : step === 1 ? { cron: '* * * * *', prompt: 'Synthetic timer check', recurring: false } : {};
  const content = name ? { type: 'tool_use', id: `toolu_synthetic_${step}`, name, input: {} } : { type: 'text', text: '' };
  const text = step === 2 ? 'SCHEDULED' : 'TIMER_OK';
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of [
    { type: 'message_start', message: { id: `msg_synthetic_${step}`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: content },
    { type: 'content_block_delta', index: 0, delta: name ? { type: 'input_json_delta', partial_json: JSON.stringify(input) } : { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: name ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  response.end();
}
