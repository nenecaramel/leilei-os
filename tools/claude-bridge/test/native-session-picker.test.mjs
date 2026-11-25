import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../src/native-session-picker.mjs').catch(() => ({}));
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
const D = '00000000-0000-4000-8000-000000000004';
const row = (conversationId = C) => ({ conversationId, title: 'same title', updatedAt: '2026-10-11T00:00:00Z', headMessageId: D, providerSessionId: A, providerCheckpointId: D, sourceSessionId: A, busy: false });
const desktop = () => ({ desktopSessionId: `local_${B}`, providerSessionId: A, title: 'same title', updatedAt: '2026-10-11T00:00:00Z', nativeRevision: 'a'.repeat(64), history: { state: 'not_requested' }, continuationReady: true });

test('picker does not default to first or newest conversation and rejects invalid input', () => {
  assert.equal(typeof module.pickSwitchChoice, 'function');
  const choices = [{ sessionId: A }, { sessionId: B }];
  for (const input of ['', '0', '3', '1.0', '-1', '1;rm', 'abc']) assert.throws(() => module.pickSwitchChoice(choices, input), /INVALID_SELECTION/);
  assert.throws(() => module.pickSwitchChoice(choices, 'q'), /SELECTION_CANCELLED/);
  assert.equal(module.pickSwitchChoice(choices, '2'), choices[1]);
});

test('Desktop-bound choices preserve conversation identity, not title, and block session-less or file-less conversations', () => {
  assert.equal(typeof module.buildSwitchChoices, 'function');
  const choices = module.buildSwitchChoices('desktop', [row(C), { ...row(B), providerSessionId: null, sourceSessionId: null }, { ...row(D), providerSessionId: B }], [desktop()]);
  assert.equal(choices[0].conversationId, C);
  assert.equal(choices[0].sessionId, A);
  assert.equal(choices[0].reason, null);
  assert.equal(choices[1].reason, 'NATIVE_SOURCE_BINDING_REQUIRED', 'a conversation that never ran a turn has no native session');
  assert.equal(choices[2].reason, 'NATIVE_SESSION_FILE_REQUIRED', 'no Desktop window and no local transcript');
  assert.throws(() => module.pickSwitchChoice(choices, '2'), /NATIVE_SOURCE_BINDING_REQUIRED/);
});

test('a conversation started in LeileiOS can be handed to Desktop without an earlier Desktop binding', () => {
  // Continuation-only switching releases the head checkpoint's own session;
  // the server creates the binding on release. A local transcript opens a new window.
  const born = { ...row(B), providerSessionId: B, sourceSessionId: null };
  const [local] = module.buildSwitchChoices('desktop', [born], [desktop()], { localSessionIds: new Set([B]) });
  assert.equal(local.reason, null);
  assert.equal(local.opensNewWindow, true);
  assert.equal(local.sessionId, B);
  const [missing] = module.buildSwitchChoices('desktop', [born], [desktop()]);
  assert.equal(missing.reason, 'NATIVE_SESSION_FILE_REQUIRED');
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
  assert.equal(module.buildSwitchChoices('leileios', [], [{ ...desktop(), error: 'NATIVE_TURN_UNFINISHED' }])[0].reason, 'NATIVE_TURN_UNFINISHED');
  assert.equal(module.buildSwitchChoices('leileios', [], [{ ...desktop(), continuationReady: undefined }])[0].reason, 'NATIVE_HISTORY_UNAVAILABLE');
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

test('LeileiOS branch without a Desktop window is handed back through its local transcript and a new window', () => {
  const E = '00000000-0000-4000-8000-000000000005';
  const forkedHere = { ...row(C), providerSessionId: E, sourceSessionId: A };
  const [choice] = module.buildSwitchChoices('desktop', [forkedHere], [desktop()], { localSessionIds: new Set([A, E]) });
  assert.deepEqual([choice.sessionId, choice.desktopSessionId, choice.opensNewWindow, choice.reason], [E, null, true, null]);
  assert.match(module.formatSwitchMenu([choice]), /将在官端新开窗口/);
});

test('continuation picker reuses only the current exact Session; a fork creates an empty new entry', () => {
  const s = desktop();
  assert.equal(module.buildSwitchChoices('leileios', [row()], [s])[0].conversationId, C);
  const fork = { ...s, providerSessionId: B, forkedFromDesktopSessionId: `local_${A}` };
  const next = module.buildSwitchChoices('leileios', [row()], [fork])[0];
  assert.equal(next.conversationId, B);
  assert.equal(next.branch, 'new');
  assert.equal(next.reason, null);
  const obsoleteSource = { ...row(), providerSessionId: B };
  assert.equal(module.buildSwitchChoices('leileios', [obsoleteSource], [s])[0].conversationId, A);
  assert.equal(module.buildSwitchChoices('desktop', [row()], [s])[0].reason, null);
  // Lineage, earlier ids and window forks identify history, never a conversation to continue.
  const lineage = { ...row(), providerSessionId: B, sourceSessionId: B, sourceLineage: [A] };
  const rotated = { ...s, priorProviderSessionIds: [B], rewindEdges: [{ child: A, parent: B, forkPoint: D }] };
  for (const session of [s, rotated]) {
    const [choice] = module.buildSwitchChoices('leileios', [lineage], [session]);
    assert.deepEqual([choice.conversationId, choice.branch, choice.reason], [A, 'new', null]);
  }
});

test('reverse picker hides archived Desktop windows without deleting or mutating catalog rows', () => {
  const active = desktop();
  const archived = { ...desktop(), providerSessionId: B, desktopSessionId: `local_${D}`, title: 'Archived', isArchived: true, error: 'UNSUPPORTED_DESKTOP_SESSION_INDEX' };
  const sessions = [active, archived];
  const before = structuredClone(sessions);
  const choices = module.buildSwitchChoices('leileios', [], sessions);
  assert.equal(choices.length, 1);
  assert.equal(choices[0].sessionId, A);
  assert.deepEqual(sessions, before);
});
