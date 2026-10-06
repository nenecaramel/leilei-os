import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, rmSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';

test('actual hosted ChatView actions retain state, identity, attachments, voice and lifecycle', {
  skip: !process.env.CHAT_ORCHESTRATION_SIMULATOR ? 'Requires CHAT_ORCHESTRATION_SIMULATOR' : false,
}, () => {
  const dir = process.env.CHAT_ORCHESTRATION_CACHE ?? mkdtempSync(path.join(os.tmpdir(), 'chat-orchestration-smoke-'));
  const sim = process.env.CHAT_ORCHESTRATION_SIMULATOR!, bundle = 'com.leileios.tests.chat-orchestration';
  mkdirSync(dir, { recursive: true });
  try {
    cpSync('ios/LeileiOS', path.join(dir, 'ios'), { recursive: true, filter: p => !p.includes('xcuserdata') });
    const root = path.join(dir, 'ios/LeileiOS');
    // Stub external AppModel operations only in the disposable compilation copy.
    // The actual ChatView extensions, SwiftUI State/FocusState and presentation
    // models remain production code. Nothing contacts the owner's account.
    function replace(file: string, name: string, body: string) {
      const p = path.join(root, 'App', file), s = readFileSync(p, 'utf8');
      const a = s.indexOf('func ' + name + '('); assert.notEqual(a, -1, name);
      const open = s.indexOf('{', a); let depth = 1, end = open + 1;
      for (; depth; end++) { if (s[end] === '{') depth++; if (s[end] === '}') depth--; }
      writeFileSync(p, s.slice(0, open + 1) + '\n' + body + '\n' + s.slice(end - 1));
    }
    for (const name of ['sendNativeLiveMessage', 'editNativeLiveMessage', 'retryNativeLiveMessage']) {
      const args = name === 'retryNativeLiveMessage' ? 'targetUserMessageID, nil, [], nil, execution, presentationOperation' : name === 'editNativeLiveMessage' ? 'targetUserMessageID, text, attachmentIDs ?? [], nil, execution, presentationOperation' : 'nil, text, attachmentIDs, nil, execution, presentationOperation, inputMode: inputMode';
      replace('NativeLiveTurnController.swift', name, `try await OrchestrationProbe.operation("${name}", ${args})`);
    }
    replace('NativeLiveTurnController.swift', 'recoverActiveNativeLiveTurn', 'OrchestrationProbe.lifecycle.append("recover")');
    replace('NativeLiveRuntimeStore.swift', 'sendNativeLiveMidTurnInput', 'OrchestrationProbe.midCalls += 1; if OrchestrationProbe.failure { throw NativeLiveSendError.notReady }; return "exact-control"');
    replace('NativeLiveRuntimeStore.swift', 'interruptNativeLiveTurn', 'OrchestrationProbe.interruptCalls += 1; await OrchestrationProbe.pause()');
    replace('NativeLiveAttachmentCoordination.swift', 'uploadNativeLiveAttachment', 'return try await OrchestrationProbe.upload(data, filename, mimeType, kind)');
    replace('ConversationCoordination.swift', 'createNativeLiveConversation', 'OrchestrationProbe.lifecycle.append("create"); nativeLiveCurrentPath = OrchestrationProbe.path(head: nil, token: "rebased"); return OrchestrationProbe.id');
    replace('ConversationCoordination.swift', 'refreshNativeLiveConversations', '');
    replace('ConversationCoordination.swift', 'refreshNativeLiveConversationHistorySnapshot', 'OrchestrationProbe.lifecycle.append("history")');
    replace('ConversationCoordination.swift', 'refreshNativeLiveCurrentPath', 'OrchestrationProbe.lifecycle.append("path")');
    replace('ConversationCoordination.swift', 'beginNativeLiveConversationHeadObservation', 'OrchestrationProbe.lifecycle.append("observe:" + conversationID.uuidString)');
    const model = path.join(root, 'App/AppModel.swift');
    writeFileSync(model, readFileSync(model, 'utf8').replace('try? KeychainAccessTokenStore().clear()', '// Isolated fixture must never touch owner credentials.'));
    const chat = path.join(root, 'Chat/ChatView.swift');
    writeFileSync(chat, readFileSync(chat, 'utf8').replace('.task(id: appModel.activeNativeLiveConversationID)', '.task { await OrchestrationChecks.run(self, appModel) }\n.task(id: appModel.activeNativeLiveConversationID)'));
    writeFileSync(path.join(root, 'App/LeileiOSApp.swift'), readFileSync('tests/fixtures/chat-orchestration-smoke.swift', 'utf8'));
    const build = spawnSync('xcodebuild', ['-project', path.join(dir, 'ios/LeileiOS.xcodeproj'), '-scheme', 'LeileiOS', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', path.join(dir, 'build'), 'ARCHS=arm64', 'ONLY_ACTIVE_ARCH=YES', 'COMPILER_INDEX_STORE_ENABLE=NO', 'CODE_SIGNING_ALLOWED=NO', `PRODUCT_BUNDLE_IDENTIFIER=${bundle}`, 'build'], { encoding: 'utf8', timeout: 600000, maxBuffer: 30_000_000 });
    writeFileSync(path.join(dir, 'build.log'), build.stdout + build.stderr);
    assert.equal(build.status, 0, (build.stdout + build.stderr).split('\n').filter(l => l.includes('error:')).join('\n'));
    const install = spawnSync('xcrun', ['simctl', 'install', sim, path.join(dir, 'build/Build/Products/Debug-iphonesimulator/LeileiOS.app')], { encoding: 'utf8' });
    assert.equal(install.status, 0, install.stderr);
    const fd = openSync(path.join(dir, 'run.log'), 'w');
    const run = spawnSync('xcrun', ['simctl', 'launch', '--console', '--terminate-running-process', sim, bundle], { stdio: ['ignore', fd, fd], timeout: 180000 });
    closeSync(fd); const output = readFileSync(path.join(dir, 'run.log'), 'utf8'); console.info(output.trim());
    assert.equal(run.status, 0, output); assert.match(output, /Chat orchestration smoke PASS/);
  } finally {
    spawnSync('xcrun', ['simctl', 'uninstall', sim, bundle]);
    if (!process.env.CHAT_ORCHESTRATION_CACHE) rmSync(dir, { recursive: true, force: true });
  }
});
