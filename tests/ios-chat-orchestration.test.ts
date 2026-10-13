import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = process.env.CHAT_ORCHESTRATION_ROOT ?? 'ios/LeileiOS/LeileiOS/Chat/';
const baseline = readFileSync('tests/fixtures/chat-orchestration-main-6caf274f.swift', 'utf8');
const read = (file: string) => readFileSync(root + file, 'utf8');
const compact = (s: string) => s.replace(/\s/g, '');
const withoutRetiredBinding = (s: string) => s
  .replace(/    @Binding var selectedWorkspaceID: String\?\n/g, '')
  .replace(/                let shouldBindWorkspace =[\s\S]*?(?=                try await appModel.sendNativeLiveMessage)/g, '')
  .replace(/                    workspaceID:[\s\S]*?(?=                    execution:)/g, '');
function block(s: string, marker: string) {
  const start = s.indexOf(marker); assert.notEqual(start, -1, marker);
  const open = s.indexOf('{', start); let depth = 1, end = open + 1;
  for (; depth && end < s.length; end++) { if (s[end] === '{') depth++; if (s[end] === '}') depth--; }
  assert.equal(depth, 0, marker); return s.slice(open + 1, end - 1);
}
const boundaries = {
  'ChatView+RuntimeControl.swift': ['visibleRuntimeSurface:', 'isRuntimeTurnActive:', 'pendingMidTurnDeliverySignal:', 'runtimeInterruptRequested:', 'sendMidTurnInput(', 'reconcilePendingMidTurnDelivery(', 'interruptCurrentTurn()'],
  'ChatView+MessageMutation.swift': ['retryMessage(', 'beginEditing(', 'cancelEditing()', 'executionSelection:', 'sendMessage()', 'voiceEnabled:', 'sendVoiceMessage(', 'sendNewMessage('],
  'ChatView+AttachmentFlow.swift': ['addAttachment(', 'retryAttachmentUpload(', 'uploadAttachment(', 'importPhotos(', 'importFiles('],
  'ChatView+ConversationLifecycle.swift': ['isConversationLoading:'],
};
test('responsibility boundaries preserve complete action bodies and Task ownership', () => {
  assert.equal(createHash('sha1').update(`blob ${Buffer.byteLength(baseline)}\0`).update(baseline).digest('hex'), '9c5c33766f08bfd06b092014a0559e4212e345af', 'Characterization source is the exact base main Git blob');
  for (const [file, names] of Object.entries(boundaries)) {
    assert.ok(existsSync(root + file), `Missing responsibility boundary: ${file}`);
    const source = read(file);
    assert.match(source, /extension ChatView/);
    assert.doesNotMatch(source, /ObservableObject|\bactor\b|@State|@FocusState/);
    for (const name of names) {
      const marker = /:$/.test(name) ? 'var ' + name : 'func ' + name;
      let expected = compact(withoutRetiredBinding(block(baseline, marker)));
      if (file === 'ChatView+MessageMutation.swift' && name === 'sendNewMessage(') {
        expected = expected
          .replace('letattachmentIDs=', 'sendFailureMessage=nilletattachmentIDs=')
          .replace('}catch{pendingOperation=nilifinputMode==.voice', '}catch{sendFailureMessage=error.localizedDescriptionpendingOperation=nilifinputMode==.voice');
      }
      assert.equal(compact(block(source, marker)), expected, `${file}: ${name}`);
    }
  }
  assert.equal(compact(block(read('NativeLiveCameraPicker.swift'), 'struct NativeLiveCameraPicker:')), compact(block(baseline, 'struct NativeLiveCameraPicker:')));
});
test('page retains state wrappers, lifecycle installation and exact UI/scroll wiring', () => {
  assert.ok(existsSync(root + 'ChatView+ConversationLifecycle.swift'), 'Conversation refresh boundary must exist');
  const current = read('ChatView.swift');
  const stateSection = (s: string) => compact(s.slice(s.indexOf('struct ChatView:'), s.indexOf('var body:')).replace(/\bprivate\s+/g, ''));
  const expectedState = stateSection(withoutRetiredBinding(baseline))
    .replace('@StateObjectvarvoiceInput=VoiceInputController()', '@StateObjectvarvoiceInput=VoiceInputController()@StatevarisNativeCallPresented=false')
    .replace('@StatevarmessageText=""', '@StatevarmessageText=""@StatevarsendFailureMessage:String?')
    // Composer selections persist across page recreation; other ownership stays exact.
    .replace('@Statevarmodel:NativeLiveClaudeModel=.opus55', '@AppStorage("nativeLive.model")varmodel:NativeLiveClaudeModel=.opus55')
    .replace('@Statevareffort:NativeLiveEffortLevel=.high', '@AppStorage("nativeLive.effort")vareffort:NativeLiveEffortLevel=.high');
  assert.equal(stateSection(current), expectedState, 'All page state and AppModel pending-operation ownership stay in place');
  const lifecycle = read('ChatView+ConversationLifecycle.swift');
  const sequence = block(lifecycle, 'func refreshConversationPage()');
  const expandedBody = block(current, 'var body:').replace(/await refreshConversationPage\(\)/g, sequence);
  const sendFailureAlert = compact(`
    .alert("Failed", isPresented: Binding(
        get: { sendFailureMessage != nil },
        set: { if !$0 { sendFailureMessage = nil } }
    )) {
        Button("OK", role: .cancel) { sendFailureMessage = nil }
    } message: {
        Text(sendFailureMessage ?? "")
    }
  `);
  // Accepted 6d39a039 adds the call entry and sheet; all older wiring stays exact.
  const callEntry = compact(`
    canStartVoiceCall: !isDraftConversation && appModel.isAuthenticated
        && appModel.activeNativeLiveConversationID != nil
        && appModel.chatSendState != .sending && !isRuntimeTurnActive
        && pendingOperation == nil && !voiceInput.isActive,
    onStartVoiceCall: {
        voiceInput.cancel()
        isComposerFocused = false
        isNativeCallPresented = true
    },
  `);
  const callSheet = compact(`
    .sheet(isPresented: $isNativeCallPresented) {
        if let conversationID = appModel.activeNativeLiveConversationID {
            NavigationStack {
                NativeLiveCallView(conversationID: conversationID, execution: executionSelection)
            }
            .environmentObject(appModel)
        }
    }
  `);
  const expectedBody = compact(block(baseline, 'var body:'))
    .replace('onRemoveAttachment:', callEntry + 'onRemoveAttachment:')
    .replace('.photosPicker(', callSheet + '.photosPicker(')
    .replace('.overlay{ifisConversationLoading{', sendFailureAlert + '.overlay{ifisConversationLoading{');
  assert.equal(compact(expandedBody), expectedBody, 'Only accepted refresh, send-failure alert and guarded call entry differ; every other modifier, Task, callback, focus and layout stays identical');
  assert.equal((block(current, 'var body:').match(/await refreshConversationPage\(\)/g) ?? []).length, 3);
  assert.doesNotMatch(current, /ScrollView|ScrollViewReader|scrollPosition|GeometryReader|\.scrollDismissesKeyboard/);
});
test('actual Swift runtime control preserves acceptance, exact IDs and pending interrupt guards', { skip: process.platform !== 'darwin' }, () => {
  assert.ok(existsSync(root + 'ChatView+RuntimeControl.swift'), 'Runtime control boundary must exist');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'chat-orchestration-runtime-'));
  try {
    let runtimeFile = root + 'ChatView+RuntimeControl.swift';
    if (process.env.CHAT_ORCHESTRATION_MUTATION) {
      let source = read('ChatView+RuntimeControl.swift');
      if (process.env.CHAT_ORCHESTRATION_MUTATION === 'premature') source = source.replace('signal == "receipt:queued"', 'signal == "lifecycle:received" || signal == "receipt:queued"');
      else if (process.env.CHAT_ORCHESTRATION_MUTATION === 'interrupt') source = source.replace('guard !isRuntimeControlInFlight,', 'guard true,');
      else assert.fail('Unknown runtime mutation');
      runtimeFile = path.join(dir, 'Runtime.swift'); writeFileSync(runtimeFile, source);
    }
    const files = ['ios/LeileiOS/LeileiOS/Infrastructure/NativeLiveRuntimeModels.swift', 'ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveModels.swift', 'ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveInputMode.swift', runtimeFile, 'tests/fixtures/chat-orchestration-runtime.swift'];
    const build = spawnSync('xcrun', ['swiftc', '-parse-as-library', '-module-cache-path', path.join(dir, 'cache'), ...files, '-o', path.join(dir, 'check')], { encoding: 'utf8', timeout: 180000 });
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(path.join(dir, 'check'), [], { encoding: 'utf8', timeout: 60000 });
    assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /Runtime orchestration PASS/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
