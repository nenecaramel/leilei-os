import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';

const files = ['ChatView.swift','ChatComposer.swift','ComposerComponents.swift','NativeLiveMessageSurface.swift','MessageSurface/NativeLiveMessageRows.swift','MessageSurface/NativeLiveMessageBlocks.swift','MessageSurface/NativeLiveAssistantTurnRow.swift'];
// Adapt retired APIs only in the generated copy; historical fixture bytes stay pinned.
const historicalSourceSHA256: Record<string,string> = {
  'ChatView.swift': 'fadf0546e6324069273789c9aad60cb4ca37daf0b0564b9cb375dde2adb49d59',
  'ChatComposer.swift': '7f03eab1104e165c7e18a526e3fa12c5c023cbece404721ca6ac68cca244f861',
  'ComposerComponents.swift': '29a2ecdd56212b0aee07ae86c11d223d5a6828130ddfa52767a6905844ced79d',
  'NativeLiveMessageSurface.swift': '58e1aa3594fad62fc8a3805d95b7dc6212cea1f16f1994d54185d620361937b9',
  'MessageSurface/NativeLiveMessageRows.swift': '0e05ae900eadad76424a66fa2e967d58807981bc1d254519c22843843951c756',
  'MessageSurface/NativeLiveMessageBlocks.swift': 'a48ef1f77b9ff80474156cc01be9e647b56fb325a65a8f108965b80e93e0a45b',
  'MessageSurface/NativeLiveAssistantTurnRow.swift': '1afc95c6ed019f7768125b39de8a18cf1bbb75da83228982d4b7e11a9b4441d7',
};
function readPinnedChatFixture(file: string) {
  const source=readFileSync('tests/fixtures/chat-main-2425b8b6/'+file,'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'),historicalSourceSHA256[file],`Immutable historical source changed: ${file}`);
  return source;
}
function adaptRetiredChatAPIs(source: string, file: string) {
  if (file === 'ChatView.swift') {
    const workspace = `                    workspaceID:
                        shouldBindWorkspace
                            ? selectedWorkspaceID
                            : nil,
`;
    assert.ok(source.includes(workspace), 'Pinned workspace argument changed');
    source = source.replace(workspace, '');
  }
  if (file === 'MessageSurface/NativeLiveAssistantTurnRow.swift') {
    for (const retired of [
      '            AlbumSaveIndicator(count:turn.parentUserMessageID.flatMap { appModel.albumSavesByUserMessageID[$0]?.total } ?? 0)\n',
      '            if let user = turn.parentUserMessageID { await appModel.refreshAlbumSaves(userMessageID:user,force:isCurrentHead) }\n',
    ]) {
      assert.ok(source.includes(retired), 'Pinned album retirement boundary changed');
      source = source.replace(retired, '');
    }
  }
  return source;
}
// Apply only already-approved process/footer chrome (cccf6e6e, a553c665,
// 3cabae39, d5a929c1 and action alignment/rotations), preserving pinned content/callbacks.
function approvedHistoricalChrome(source: string, file: string) {
  const replacePinned = (before: string, after: string) => {
    assert.equal(source.split(before).length, 2, `Pinned chrome boundary changed: ${file}`);
    source = source.replace(before, after);
  };
  if (file === 'ChatComposer.swift') {
    // 6d39a039 keeps the plus menu enabled for the independent call entry,
    // while the same three historical attachment callbacks remain disabled.
    const start=source.indexOf('                Menu {');
    const end=source.indexOf('                Menu {',start+1);
    assert.ok(start>=0 && end>start,'Pinned attachment menu boundary changed');
    let menu=source.slice(start,end);
    const predicate=`                .disabled(
                    isRuntimeTurnActive
                        || isSending
                        || attachments.count >= 8
                )`;
    assert.equal(menu.split(predicate).length,2,'Pinned attachment disable predicate changed');
    menu=menu.replace(predicate,'');
    for (const [title,symbol] of [['Photo','photo'],['Camera','camera'],['File','doc']]) {
      const label=`                        Label("${title}", systemImage: "${symbol}")\n                    }`;
      assert.equal(menu.split(label).length,2,'Pinned attachment action changed');
      menu=menu.replace(label,label+'\n'+predicate);
    }
    source=source.slice(0,start)+menu+source.slice(end);
  }
  if (file === 'NativeLiveMessageSurface.swift') replacePinned('LazyVStack(spacing: 21)', 'LazyVStack(spacing: 25)');
  if (file === 'MessageSurface/NativeLiveAssistantTurnRow.swift') {
    replacePinned('HStack(spacing:12)', 'HStack(spacing:10)');
    replacePinned('timestampText:turn.timestamp.map { MessageTimestampFormatter.string(from:$0) },header:turn.header,', 'header:turn.header,');
    replacePinned(`} else if let timestamp = turn.timestamp {
                Text(MessageTimestampFormatter.string(from:timestamp)).font(.system(size:13.5)).foregroundStyle(.secondary)
            }`, '}');
    replacePinned('            if !turn.header.isEmpty || turn.murmurText != nil {', '            Group {\n            if !turn.header.isEmpty || turn.murmurText != nil {');
    replacePinned('            }\n            NativeLiveMessagePresentationView', '            }\n            }.padding(.bottom, turn.stepCount > 0 ? 12 : 0)\n            NativeLiveMessagePresentationView');
    replacePinned('Image(systemName:"arrow.clockwise").frame(width:22,height:22)', 'Image(systemName:"arrow.clockwise").rotationEffect(.degrees(20)).frame(width:22,height:22,alignment:.leading)');
    replacePinned('Image(systemName:isCopied ? "checkmark" : "square.on.square").frame(width:22,height:22)', 'Image(systemName:isCopied ? "checkmark" : "square.on.square").rotationEffect(.degrees(isCopied ? 0 : 180)).frame(width:22,height:22,alignment:.leading)');
    replacePinned('            }.font(.system(size:14))', `                if let timestamp = turn.timestamp {
                    Text(MessageTimestampFormatter.string(from:timestamp)).font(.system(size:12)).tracking(0.12).foregroundStyle(.secondary)
                }
            }.font(.system(size:14))`);
  }
  if (file === 'MessageSurface/NativeLiveMessageRows.swift') {
    const timestamp=`                Text(
                    MessageTimestampFormatter.string(
                        from: message.time,
                        timeZoneIdentifier: timeZone
                    )
                )
                .font(.system(size: 13.5))
                .tracking(0.12)
                .foregroundStyle(.secondary)
                .padding(.bottom, 4)

`;
    assert.equal(source.split(timestamp).length,2,'Pinned complete history timestamp block changed');
    const start=source.indexOf(timestamp);
    const end=start+timestamp.length;
    source = source.slice(0, start) + source.slice(end);
    const marker = '                .textSelection(.enabled)';
    const position = source.indexOf(marker, start);
    assert.ok(position >= start);
    const insertion = position + marker.length;
    source = source.slice(0, insertion) + '\n\n' + timestamp.replace('.padding(.bottom, 4)', '.padding(.top, 4)').replace('size: 13.5', 'size: 12').trimEnd() + source.slice(insertion);
  }
  return source;
}
function instrument(source: string, file: string) {
  if (file === 'ChatView.swift') {
    source = source.replace('.padding(.horizontal, 12)', '.chatFrame("composer")\n.padding(.horizontal, 12)');
    // Insert at the same boundary after refactoring to a named value.
    if (!source.includes('.chatFrame("composer")')) source = source.replace('.padding(.horizontal, ChatPresentationLayout.composerOuterHorizontal)', '.chatFrame("composer")\n.padding(.horizontal, ChatPresentationLayout.composerOuterHorizontal)');
    source = source.replace('.task(id: appModel.activeNativeLiveConversationID)', '.onAppear { isComposerFocused = ChatRenderFixtures.keyboardShown }\n.task(id: appModel.activeNativeLiveConversationID)');
    source += `\nextension ChatView {
      static func fixture(_ name: String) -> ChatView {
        var view = ChatView(isDraftConversation:true,draftConversationID:ChatRenderFixtures.id,${source.includes("@Binding var selectedWorkspaceID") ? "selectedWorkspaceID:.constant(nil)," : ""}onDraftCommitted:{})
        view._messageText = State(initialValue:ChatRenderFixtures.text(name))
        view._composerAttachments = State(initialValue:ChatRenderFixtures.attachments(name))
        if name == "edit" { view._editDraft = State(initialValue:NativeLiveEditDraft(targetUserMessageID:"user",text:"Edit me")) }
        return view
      }
    }\n`;
  }
  if (file === 'ChatComposer.swift' || file === 'ComposerPresentationComponents.swift' || file === 'ComposerAttachmentStrip.swift') {
    // Measure the actual static symbol, independently of the surrounding control.
    for (const [symbol, weight] of [['composerActionSymbol','composerActionWeight'],['presentation.symbol','presentation.weight']]) {
      const glyph=`Image(systemName: ${symbol})\n                    .font(LeileiUI.Typography.controlGlyph(weight: ${weight}))\n                    .foregroundStyle(.white)`;
      source=source.replace(glyph,glyph+'.chatFrame("primary-glyph")');
    }
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
  if (file === 'MessageSurface/NativeLiveMessageBlocks.swift' || file === 'MessageSurface/NativeLiveUserMessageRow.swift') source = source.replace('.onTapGesture { if onEdit == nil', '.chatFrame("user-bubble")\n.onTapGesture { if onEdit == nil');
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
    for (const file of ['ComposerPresentationComponents.swift','ComposerAttachmentStrip.swift','MessageSurface/NativeLiveMessageList.swift','MessageSurface/NativeLiveMessageSurfaceChrome.swift','MessageSurface/NativeLiveUserMessageRow.swift']) { const p=path.join(root,'Chat',file); if (existsSync(p)) writeFileSync(p,instrument(readFileSync(p,'utf8'),file)); }
    const original = files.map(f=>approvedHistoricalChrome(adaptRetiredChatAPIs(readPinnedChatFixture(f),f),f));
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
    closeSync(fd);const output=readFileSync(runLog,'utf8');console.info(output.trim());
    if (output.includes('DIAGNOSTIC ')) {
      const container=spawnSync('xcrun',['simctl','get_app_container',simulator,bundle,'data'],{encoding:'utf8'});
      const diagnostics=path.join(container.stdout.trim(),'Documents/ChatEquivalenceDiagnostics');
      if (container.status===0 && existsSync(diagnostics)) cpSync(diagnostics,path.join(dir,'diagnostics'),{recursive:true});
    }
    assert.ifError(checked.error); assert.equal(checked.status,0,output); assert.match(output,/Chat render equivalence PASS/);
  } finally {
    spawnSync('xcrun',['simctl','uninstall',simulator,bundle]); if (!process.env.UI_CHAT_RENDER_CACHE) rmSync(dir,{recursive:true,force:true});
  }
});
