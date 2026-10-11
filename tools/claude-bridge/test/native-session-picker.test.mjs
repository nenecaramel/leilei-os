import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../src/native-session-picker.mjs').catch(() => ({}));
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
const D = '00000000-0000-4000-8000-000000000004';
const row = (conversationId = C) => ({ conversationId, title: 'same title', updatedAt: '2026-10-11T00:00:00Z', headMessageId: D, providerSessionId: A, providerCheckpointId: D, sourceSessionId: A, busy: false });
const desktop = () => ({ desktopSessionId: `local_${B}`, providerSessionId: A, title: 'same title', updatedAt: '2026-10-11T00:00:00Z', nativeRevision: 'a'.repeat(64), history: { state: 'complete' } });

test('picker does not default to first or newest conversation and rejects invalid input', () => {
  assert.equal(typeof module.pickSwitchChoice, 'function');
  const choices = [{ sessionId: A }, { sessionId: B }];
  for (const input of ['', '0', '3', '1.0', '-1', '1;rm', 'abc']) assert.throws(() => module.pickSwitchChoice(choices, input), /INVALID_SELECTION/);
  assert.throws(() => module.pickSwitchChoice(choices, 'q'), /SELECTION_CANCELLED/);
  assert.equal(module.pickSwitchChoice(choices, '2'), choices[1]);
});

test('Desktop-bound choices preserve conversation identity, not title, and block unindexed new sessions', () => {
  assert.equal(typeof module.buildSwitchChoices, 'function');
  const choices = module.buildSwitchChoices('desktop', [row(C), { ...row(B), providerSessionId: B, sourceSessionId: null }], [desktop()]);
  assert.equal(choices[0].conversationId, C);
  assert.equal(choices[0].sessionId, A);
  assert.equal(choices[0].reason, null);
  assert.equal(choices[1].reason, 'DESKTOP_INDEX_REQUIRED');
  assert.throws(() => module.pickSwitchChoice(choices, '2'), /DESKTOP_INDEX_REQUIRED/);
});

test('reverse switch reuses exact restored conversation; first restore alone uses native identity', () => {
  assert.equal(typeof module.buildSwitchChoices, 'function');
  assert.equal(module.buildSwitchChoices('leileios', [row()], [desktop()])[0].conversationId, C);
  assert.equal(module.buildSwitchChoices('leileios', [], [desktop()])[0].conversationId, A);
  const ambiguous = module.buildSwitchChoices('leileios', [row(C), row(B)], [desktop()]);
  assert.equal(ambiguous[0].reason, 'AMBIGUOUS_NATIVE_SELECTION');
  const unbound = module.buildSwitchChoices('leileios', [{ ...row(), sourceSessionId: null }], [desktop()]);
  assert.equal(unbound[0].reason, 'NATIVE_SOURCE_BINDING_REQUIRED');
});

test('busy, incomplete and duplicate identities remain blocked without guessing', () => {
  assert.equal(typeof module.buildSwitchChoices, 'function');
  assert.equal(module.buildSwitchChoices('desktop', [{ ...row(), busy: true }], [desktop()])[0].reason, 'NATIVE_CONVERSATION_BUSY');
  assert.equal(module.buildSwitchChoices('desktop', [row()], [desktop(), desktop()])[0].reason, 'AMBIGUOUS_NATIVE_SELECTION');
  assert.equal(module.buildSwitchChoices('leileios', [], [{ ...desktop(), history: { state: 'unavailable', reason: 'NATIVE_HISTORY_GAP' } }])[0].reason, 'NATIVE_HISTORY_GAP');
});

test('interactive dispatch requires terminal and selection, rechecks identity before calling existing handoff', async () => {
  assert.equal(typeof module.selectAndSwitch, 'function');
  let calls = 0;
  const load = async () => module.buildSwitchChoices('desktop', [row()], [desktop()]);
  const run = async (mode, choice) => { calls++; assert.equal(mode, 'desktop'); assert.equal(choice.conversationId, C); return 'done'; };
  await assert.rejects(module.selectAndSwitch('desktop', { isTTY: false, load, run }), /INTERACTIVE_TERMINAL_REQUIRED/);
  await assert.rejects(module.selectAndSwitch('desktop', { isTTY: true, load, ask: async () => 'q', display() {}, run }), /SELECTION_CANCELLED/);
  let reads = 0;
  await assert.rejects(module.selectAndSwitch('desktop', { isTTY: true, load: async () => { const result = await load(); if (reads++) result[0].headMessageId = B; return result; }, ask: async () => '1', display() {}, run }), /STALE_NATIVE_SELECTION/);
  assert.equal(calls, 0);
  assert.equal(await module.selectAndSwitch('desktop', { isTTY: true, load, ask: async () => '1', display() {}, run }), 'done');
  assert.equal(calls, 1);
});

test('menu keeps titles distinguishable by stable identity and strips terminal controls', () => {
  assert.equal(typeof module.formatSwitchMenu, 'function');
  const choices = module.buildSwitchChoices('desktop', [{ ...row(C), title: '\u001b[31mbad\nline' }, row(B)], [desktop()]);
  const text = module.formatSwitchMenu(choices);
  assert.ok(text.includes(C)); assert.ok(text.includes(B));
  assert.doesNotMatch(text, /\u001b/);
});

test('native history advancing during selection cannot silently change the chosen checkpoint', async () => {
  let reads = 0, writes = 0;
  await assert.rejects(module.selectAndSwitch('leileios', { isTTY: true,
    load: async () => { const s = desktop(); if (reads++) s.nativeRevision = 'b'.repeat(64); return module.buildSwitchChoices('leileios', [], [s]); },
    ask: async () => '1', display() {}, run() { writes++; },
  }), /STALE_NATIVE_SELECTION/);
  assert.equal(writes, 0);
});

test('source history changing during selection blocks dispatch even when current native bytes stay identical', async () => {
  let reads = 0, writes = 0;
  await assert.rejects(module.selectAndSwitch('leileios', {isTTY:true,
    load:async()=>module.buildSwitchChoices('leileios',[],[{...desktop(),historyRevision:(reads++ ? 'b' : 'a').repeat(64)}]),
    ask:async()=>'1',display(){},run(){writes++;},
  }),/STALE_NATIVE_SELECTION/);
  assert.equal(writes,0);
});
