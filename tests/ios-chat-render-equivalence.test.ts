import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';

const files = ['ChatView.swift','ChatComposer.swift','ComposerComponents.swift','NativeLiveMessageSurface.swift','MessageSurface/NativeLiveMessageRows.swift','MessageSurface/NativeLiveMessageBlocks.swift','MessageSurface/NativeLiveAssistantTurnRow.swift'];
function instrument(source: string, file: string) {
  if (file === 'ChatView.swift') {
    source = source.replace('.padding(.horizontal, 12)', '.chatFrame("composer")\n.padding(.horizontal, 12)');
    // Insert at the same boundary after refactoring to a named value.
    if (!source.includes('.chatFrame("composer")')) source = source.replace('.padding(.horizontal, ChatPresentationLayout.composerOuterHorizontal)', '.chatFrame("composer")\n.padding(.horizontal, ChatPresentationLayout.composerOuterHorizontal)');
    source = source.replace('.task(id: appModel.activeNativeLiveConversationID)', '.onAppear { isComposerFocused = ChatRenderFixtures.keyboardShown }\n.task(id: appModel.activeNativeLiveConversationID)');
    source += `\nextension ChatView {
      static func fixture(_ name: String) -> ChatView {
        var view = ChatView(isDraftConversation:true,draftConversationID:ChatRenderFixtures.id,selectedWorkspaceID:.constant(nil),onDraftCommitted:{})
        view._messageText = State(initialValue:ChatRenderFixtures.text(name))
        view._composerAttachments = State(initialValue:ChatRenderFixtures.attachments(name))
        if name == "edit" { view._editDraft = State(initialValue:NativeLiveEditDraft(targetUserMessageID:"user",text:"Edit me")) }
        return view
      }
    }\n`;
  }
  if (file === 'ChatComposer.swift' || file === 'ComposerPresentationComponents.swift' || file === 'ComposerAttachmentStrip.swift') {
    source = source.replace('.frame(height: 34)', '.frame(height: 34)\n.chatFrame("edit")').replace('.frame(height: 54)', '.frame(height: 54)\n.chatFrame("attachment-chip")').replace('.equatable()', '.equatable()\n.chatFrame("input")')
      .replace(/ComposerCircleButton\(\s*systemName: "plus",\s*weight: \.light\s*\)/g, '$&.chatFrame("plus")')
      .replace(/systemName: "chevron.down"\s*\)/g, '$&.chatFrame("keyboard-dismiss")')
      .replace(/effort: effort.displayName\s*\)/g, '$&.chatFrame("model")');
    if (file === 'ChatComposer.swift') {
      const pending = source.includes('private var actionPresentation:') ? 'actionPresentation.mode == .interruptPending' : 'isRuntimeTurnActive && interruptRequested && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty';
      const symbol = source.includes('private var composerActionSymbol:') ? 'composerActionSymbol' : 'actionPresentation.symbol';
      const weight = source.includes('private var composerActionWeight:') ? 'composerActionWeight' : 'actionPresentation.weight';
      const dimmed = source.includes('private var shouldDimPrimaryAction:') ? 'shouldDimPrimaryAction' : 'actionPresentation.isDimmed';
      source += `\nextension ChatComposer { func fixtureAction() -> [String] { [${symbol},String(describing:${weight}),String(${dimmed}),String(isVoiceActionMode),String(${pending})] } }\n`;
    }
    source = source.replace('private var voiceActionButton: some View {', 'private var measuredAction: some View { composerActionLabel.chatFrame("primary-action") }\n\n    private var voiceActionButton: some View {');
    source = source.replace(/(?<!var )\bcomposerActionLabel\n/g, 'measuredAction\n');
  }
  if (file === 'NativeLiveMessageSurface.swift' || file === 'MessageSurface/NativeLiveMessageList.swift') {
    source = source.replace('.id(row.id)', '.chatFrame("row.\\(row.id)")\n.id(row.id)')
      .replace('.id("native-live-load-older")', '.chatFrame("load-older")\n.id("native-live-load-older")')
      .replace('.accessibilityLabel("Scroll to latest")', '.accessibilityLabel("Scroll to latest")\n.chatFrame("scroll-action")')
      .replace('.transition(\n                        .move(edge: .top)', '.chatFrame("copy-feedback")\n.transition(\n                        .move(edge: .top)');
    if (file === 'NativeLiveMessageSurface.swift') source += `\nextension NativeLiveMessageSurface {
      static func fixture(_ name:String) -> NativeLiveMessageSurface {
        var view = NativeLiveMessageSurface(snapshot:ChatRenderFixtures.snapshot(name),historySnapshot:nil,syncState:.ready,isAuthenticated:true,hasActiveConversation:true,isTurnInFlight:false,pendingOperation:nil,runtimeSurface:nil,onResolveRuntimeInteraction:{_,_ in},onRefresh:{},onLoadOlder:{},onRetryMessage:{_ in},onEditMessage:{_ in})
        if name == "copy" { view._copyFeedbackText = State(initialValue:"Message copied"); view._copiedMessageID = State(initialValue:"assistant") }
        if name == "load-older" { view._isLoadingOlderMessages = State(initialValue:true) }
        if name == "return-bottom" { var state=NativeLiveConversationScrollState(); state.interactionChanged(true);state.geometryChanged(isNearBottom:false);state.interactionChanged(false);view._scrollState=State(initialValue:state) }
        return view
      }
    }\n`;
  }
  if (file === 'MessageSurface/NativeLiveMessageBlocks.swift') source = source.replace('.onTapGesture { if onEdit == nil', '.chatFrame("user-bubble")\n.onTapGesture { if onEdit == nil');
  if (file === 'MessageSurface/NativeLiveAssistantTurnRow.swift') source = source.replace('.task(id:turn.canonicalMessageID)', '.chatFrame("assistant")\n.task(id:turn.canonicalMessageID)');
  return source.replace(/\.glassEffect\(/g, ".chatTestGlass(");
}

test('Chat/Composer renders match pinned main and reject an incorrect composer paint offset', {
  skip: process.platform !== 'darwin' || !process.env.UI_CHAT_SIMULATOR_ID ? 'Requires macOS and UI_CHAT_SIMULATOR_ID' : false,
}, () => {
  const dir = process.env.UI_CHAT_RENDER_CACHE ?? mkdtempSync(path.join(os.tmpdir(),'leilei-chat-render-'));
  mkdirSync(dir,{recursive:true});
  const simulator = process.env.UI_CHAT_SIMULATOR_ID!;
  const bundle = 'com.leileios.tests.chat-equivalence';
  try {
    cpSync('ios/LeileiOS',path.join(dir,'ios'),{recursive:true,preserveTimestamps:true,filter:p=>!p.includes('xcuserdata')});
    const root = path.join(dir,'ios/LeileiOS');
    for (const file of ['ComposerPresentationComponents.swift','ComposerAttachmentStrip.swift','MessageSurface/NativeLiveMessageList.swift','MessageSurface/NativeLiveMessageSurfaceChrome.swift']) { const p=path.join(root,'Chat',file); if (existsSync(p)) writeFileSync(p,instrument(readFileSync(p,'utf8'),file)); }
    const original = files.map(f=>readFileSync('tests/fixtures/chat-main-2425b8b6/'+f,'utf8'));
    const names = new Set(original.flatMap(s=>[...s.matchAll(/\b(?:struct|class|enum|protocol)\s+(\w+)/g)].map(m=>m[1])));
    names.add('chatSoftFill');
    const renamed = (s:string)=>s.replace(new RegExp('\\b('+[...names].join('|')+')\\b','g'),n=>'Baseline'+n);
    for (let i=0;i<files.length;i++) {
      const file=files[i];
      writeFileSync(path.join(root,'Chat',file),instrument(readFileSync('ios/LeileiOS/LeileiOS/Chat/'+file,'utf8'),file));
      writeFileSync(path.join(root,'Chat','Baseline'+path.basename(file)),renamed(instrument(original[i],file)));
    }
    const rejectedNames=[...original[0].matchAll(/\b(?:struct|class|enum|protocol)\s+(\w+)/g)].map(m=>m[1]);
    const rejected=instrument(original[0].replace(': 10\n            )', ': 11\n            )'),'ChatView.swift').replace(new RegExp('\\b('+rejectedNames.join('|')+')\\b','g'),n=>'Rejected'+n);
    assert.ok(rejected.includes(': 11'), 'negative control must change the actual hidden-keyboard paint offset');
    writeFileSync(path.join(root,'Chat/RejectedChatView.swift'),rejected);
    writeFileSync(path.join(root,'App/LeileiOSApp.swift'),readFileSync('tests/fixtures/ios-chat-render-equivalence.swift','utf8'));
    const build = spawnSync('xcodebuild',['-project',path.join(dir,'ios/LeileiOS.xcodeproj'),'-scheme','LeileiOS','-sdk','iphonesimulator','-destination','generic/platform=iOS Simulator','-derivedDataPath',path.join(dir,'build'),'CODE_SIGNING_ALLOWED=NO',`PRODUCT_BUNDLE_IDENTIFIER=${bundle}`,'build'],{encoding:'utf8',timeout:600_000,maxBuffer:30_000_000});
    writeFileSync(path.join(dir,'build.log'),build.stdout+build.stderr);
    assert.equal(build.status,0,(build.stdout+build.stderr).split('\n').filter(l=>l.includes('error:')).join('\n'));
    const app=path.join(dir,'build/Build/Products/Debug-iphonesimulator/LeileiOS.app');
    const install=spawnSync('xcrun',['simctl','install',simulator,app],{encoding:'utf8'}); assert.equal(install.status,0,install.stderr);
    const runLog=path.join(dir,'run.log'); const fd=openSync(runLog,'w');
    const checked=spawnSync('xcrun',['simctl','launch','--console','--terminate-running-process',simulator,bundle],{encoding:'utf8',stdio:['ignore',fd,fd],timeout:600_000,maxBuffer:10_000_000,env:{...process.env,SIMCTL_CHILD_CHAT_NEGATIVE:process.env.UI_CHAT_NEGATIVE ?? '0'}});
    closeSync(fd);const output=readFileSync(runLog,'utf8');console.info(output.trim()); assert.ifError(checked.error); assert.equal(checked.status,0,output); assert.match(output,/Chat render equivalence PASS/);
  } finally {
    spawnSync('xcrun',['simctl','uninstall',simulator,bundle]); if (!process.env.UI_CHAT_RENDER_CACHE) rmSync(dir,{recursive:true,force:true});
  }
});
