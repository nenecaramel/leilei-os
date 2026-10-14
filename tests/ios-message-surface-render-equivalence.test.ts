import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';

const files = ['NativeLiveMessageSurface.swift','ChatPresentationLayout.swift','MessageSurface/NativeLiveConversationScrollState.swift'];
function instrument(source: string, file: string) {
  if (file === 'NativeLiveMessageSurface.swift' || file.startsWith('MessageSurface/NativeLiveMessageList') || file.startsWith('MessageSurface/NativeLiveMessageSurfaceChrome')) {
    source = source.replace('.controlSize(.small)', '.controlSize(.small)\n.chatFrame("older-progress")').replace('.id(bottomAnchorID)', '.chatFrame("bottom-anchor")\n.id(bottomAnchorID)').replace('.padding(.horizontal, ChatPresentationLayout.messageGutter)', '.chatFrame("list-content")\n.padding(.horizontal, ChatPresentationLayout.messageGutter)').replace('.id(row.id)', '.frame(height: SurfaceRuntimeProbe.fixedRowHeight)\n.chatFrame("row.\\(row.id)")\n.id(row.id)')
      .replace('.id("native-live-load-older")', '.chatFrame("load-older")\n.id("native-live-load-older")')
      .replace('.accessibilityLabel("Scroll to latest")', '.accessibilityLabel("Scroll to latest")\n.chatFrame("scroll-action")')
      .replace('.transition(\n                        .move(edge: .top)', '.chatFrame("copy-feedback")\n.transition(\n                        .move(edge: .top)');
    if (file === 'NativeLiveMessageSurface.swift') { source = source.replace('.background(Color(.systemBackground))', '.background(Color(.systemBackground))\n.chatFrame("surface")'); }
    if (file === 'NativeLiveMessageSurface.swift') {
      let index=0;
      source=source.replace(/Button \{([\s\S]*?)\} label: \{/g,(_,body)=>`Button(action: SurfaceRuntimeProbe.capture("${index++ === 0 ? 'return' : 'older'}", active:SurfaceRuntimeProbe.isActive(snapshot?.syncToken), {${body}})) {`)
        .replace('.scrollPosition($scrollPosition)', '.scrollPosition($scrollPosition)\n.onAppear { SurfaceRuntimeProbe.move = { y in scrollPosition.scrollTo(y:y) } }')
        .replace('.onScrollPhaseChange {', '.surfaceTestScrollPhaseChange(active:SurfaceRuntimeProbe.isActive(snapshot?.syncToken)) {')
        .replace('rowFrames = frames', 'if SurfaceRuntimeProbe.isActive(snapshot?.syncToken) { SurfaceRuntimeProbe.rowFrames = frames }\n                rowFrames = frames')
        .replace('scrollPosition.scrollTo(y:max(0,contentOffset + frame.minY - anchor.relativeOffset))', 'if SurfaceRuntimeProbe.isActive(snapshot?.syncToken) { SurfaceRuntimeProbe.commands.append("restore") }\n                    scrollPosition.scrollTo(y:max(0,contentOffset + frame.minY - anchor.relativeOffset))')
        .replace(/(\s+)(proxy.scrollTo\()/g,'$1if SurfaceRuntimeProbe.isActive(snapshot?.syncToken) { SurfaceRuntimeProbe.commands.append("bottom") }$1$2');
      const marker='} action: { old, metrics in';
      const at=source.indexOf(marker),open=source.indexOf('{',at);let end=open+1,depth=1;
      for(;depth;end++){if(source[end]==='{')depth++;else if(source[end]==='}')depth--;}
      const observer=source.slice(open+1,end-1).replace(/^\s*old,\s*metrics\s+in/,'');
      source=source.slice(0,open+1)+' old, metrics in if !SurfaceRuntimeProbe.replaying { fixtureGeometry(old:old,metrics:metrics,proxy:proxy) } '+source.slice(end-1);
      source=source.replace('.onAppear { SurfaceRuntimeProbe.move = { y in scrollPosition.scrollTo(y:y) } }', `.onAppear {
        guard SurfaceRuntimeProbe.isActive(snapshot?.syncToken) else {return}
        SurfaceRuntimeProbe.move = { y in scrollPosition.scrollTo(y:y) }
        SurfaceRuntimeProbe.geometry = { oldHeight,near,offset,height in fixtureGeometry(old:.init(nearBottom:false,offset:0,height:oldHeight),metrics:.init(nearBottom:near,offset:offset,height:height),proxy:proxy) }
        SurfaceRuntimeProbe.state = { [scrollState.isNearBottom,scrollState.followLatest,scrollState.userIsInteracting,scrollState.shouldFollowContent,scrollState.shouldShowReturnToBottom] }
        SurfaceRuntimeProbe.reset = { scrollState = .init();preservedAnchor=nil;anchorReplacementID=nil }
      }`);
      const pendingMarker='.onChange(of:pendingOperation?.id) { _, _ in';
      const pendingAt=source.indexOf(pendingMarker),pendingOpen=source.indexOf('{',pendingAt);let pendingEnd=pendingOpen+1,pendingDepth=1;
      for(;pendingDepth;pendingEnd++){if(source[pendingEnd]==='{')pendingDepth++;else if(source[pendingEnd]==='}')pendingDepth--;}
      const pendingObserver=source.slice(pendingOpen+1,pendingEnd-1).replace(/^\s*_,\s*_\s+in/,'').replace(/\bpendingOperation\b/g,'operation');
      source=source.slice(0,pendingOpen+1)+' _, _ in if !SurfaceRuntimeProbe.replaying { fixturePending(operation:pendingOperation,proxy:proxy) } '+source.slice(pendingEnd-1);
      source=source.replace('SurfaceRuntimeProbe.geometry = {', 'SurfaceRuntimeProbe.pending = { operation in fixturePending(operation:operation,proxy:proxy) }\n        SurfaceRuntimeProbe.geometry = {');
      source+=`\nextension NativeLiveMessageSurface { private func fixturePending(operation:NativeLivePendingOperation?,proxy:ScrollViewProxy) {${pendingObserver}} }\n`;
      source+=`\nextension NativeLiveMessageSurface { private func fixtureGeometry(old:NativeLiveScrollMetrics,metrics:NativeLiveScrollMetrics,proxy:ScrollViewProxy) {${observer}} }\n`;
      source += `\nextension NativeLiveMessageSurface {
        static func runtimeFixture(_ inputs:SurfaceRuntimeInputs,model:AppModel) -> NativeLiveMessageSurface {
          NativeLiveMessageSurface(snapshot:inputs.snapshot,historySnapshot:nil,syncState:.ready,isAuthenticated:true,hasActiveConversation:true,isTurnInFlight:false,pendingOperation:inputs.pending,runtimeSurface:nil,onResolveRuntimeInteraction:{_,_ in},onRefresh:{SurfaceRuntimeProbe.commands.append("refresh")},onLoadOlder:{
            SurfaceRuntimeProbe.commands.append("load-older")
            try? await Task.sleep(for:.milliseconds(50))
            model.nativeLiveConversationRows.insert(SurfaceRuntimeProbe.extra("older"),at:0)
          },onRetryMessage:{_ in},onEditMessage:{_ in})
        }
      }\n`;
    }
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
  return source.replace(/\.glassEffect\(/g, ".chatTestGlass(");
}

test('MessageSurface renders match exact main and reject a wrong return-button paint offset', {
  skip: process.platform !== 'darwin' || !process.env.UI_SURFACE_SIMULATOR_ID ? 'Requires macOS and UI_SURFACE_SIMULATOR_ID' : false,
}, () => {
  const dir = process.env.UI_SURFACE_RENDER_CACHE ?? mkdtempSync(path.join(os.tmpdir(),'leilei-surface-render-'));
  mkdirSync(dir,{recursive:true});
  const simulator = process.env.UI_SURFACE_SIMULATOR_ID!;
  const bundle = 'com.leileios.tests.surface-equivalence';
  try {
    cpSync('ios/LeileiOS',path.join(dir,'ios'),{recursive:true,preserveTimestamps:true,filter:p=>!p.includes('xcuserdata')});
    const root = path.join(dir,'ios/LeileiOS');
    for (const file of ['MessageSurface/NativeLiveMessageList.swift','MessageSurface/NativeLiveMessageSurfaceChrome.swift']) { const p=path.join(root,'Chat',file); if (existsSync(p)) writeFileSync(p,instrument(readFileSync(p,'utf8'),file)); }
    const pendingPath=path.join(root,'Chat/MessageSurface/NativeLivePendingOperation.swift');
    writeFileSync(pendingPath,readFileSync(pendingPath,'utf8')+`\nextension NativeLivePendingOperation { static func surfaceFixture(_ kind:Kind) -> NativeLivePendingOperation { .init(id:SurfaceRuntimeProbe.nextPendingID(),kind:kind,baselineSyncToken:"fixture",presentationAttachments:[],inputMode:.text) } }\n`);
    const original = files.map(f=>readFileSync('tests/fixtures/message-surface-main-52c957c1/'+f,'utf8'));
    // Approved 3cabae39 changes only the inter-turn spacing: 21pt -> 25pt.
    // Keep the pinned historical traversal, chrome and every other constant.
    assert.equal((original[1].match(/static let turnSpacing: CGFloat = 21/g) ?? []).length, 1);
    original[1] = original[1].replace('static let turnSpacing: CGFloat = 21', 'static let turnSpacing: CGFloat = 25');
    const names = new Set(original.flatMap(s=>[...s.matchAll(/\b(?:struct|class|enum|protocol)\s+(\w+)/g)].map(m=>m[1])));
    names.add('chatSoftFill');
    const renamed = (s:string)=>s.replace(new RegExp('\\b('+[...names].join('|')+')\\b','g'),n=>'Baseline'+n);
    for (let i=0;i<files.length;i++) {
      const file=files[i];
      writeFileSync(path.join(root,'Chat',file),instrument(readFileSync('ios/LeileiOS/LeileiOS/Chat/'+file,'utf8'),file));
      writeFileSync(path.join(root,'Chat','Baseline'+path.basename(file)),renamed(instrument(original[i],file)));
    }
    const badLayout=original[1].replace('scrollActionPaintOffset: CGFloat = 22','scrollActionPaintOffset: CGFloat = 23').replaceAll('ChatPresentationLayout','RejectedChatPresentationLayout');
    assert.ok(badLayout.includes('scrollActionPaintOffset: CGFloat = 23'));
    writeFileSync(path.join(root,'Chat/RejectedChatPresentationLayout.swift'),badLayout);
    const badSurface=instrument(original[0],'NativeLiveMessageSurface.swift').replaceAll('ChatPresentationLayout','RejectedChatPresentationLayout').replace(/\b(NativeLiveMessageSurface|NativeLiveRowFramesKey|NativeLiveScrollMetrics)\b/g,n=>'Rejected'+n);
    writeFileSync(path.join(root,'Chat/RejectedNativeLiveMessageSurface.swift'),badSurface);
    writeFileSync(path.join(root,'App/LeileiOSApp.swift'),readFileSync('tests/fixtures/ios-message-surface-render-equivalence.swift','utf8'));
    const build = spawnSync('xcodebuild',['-project',path.join(dir,'ios/LeileiOS.xcodeproj'),'-scheme','LeileiOS','-sdk','iphonesimulator','-destination','generic/platform=iOS Simulator','-derivedDataPath',path.join(dir,'build'),'CODE_SIGNING_ALLOWED=NO',`PRODUCT_BUNDLE_IDENTIFIER=${bundle}`,'build'],{encoding:'utf8',timeout:600_000,maxBuffer:30_000_000});
    writeFileSync(path.join(dir,'build.log'),build.stdout+build.stderr);
    assert.equal(build.status,0,(build.stdout+build.stderr).split('\n').filter(l=>l.includes('error:')).join('\n'));
    const app=path.join(dir,'build/Build/Products/Debug-iphonesimulator/LeileiOS.app');
    const install=spawnSync('xcrun',['simctl','install',simulator,app],{encoding:'utf8'}); assert.equal(install.status,0,install.stderr);
    const runLog=path.join(dir,'run.log'); const fd=openSync(runLog,'w');
    const checked=spawnSync('xcrun',['simctl','launch','--console','--terminate-running-process',simulator,bundle],{encoding:'utf8',stdio:['ignore',fd,fd],timeout:600_000,maxBuffer:10_000_000,env:{...process.env,SIMCTL_CHILD_SURFACE_NEGATIVE:process.env.UI_SURFACE_NEGATIVE ?? '0',SIMCTL_CHILD_SURFACE_RUNTIME_ONLY:process.env.UI_SURFACE_RUNTIME_ONLY ?? '0',SIMCTL_CHILD_SURFACE_BASELINE_SELF:process.env.UI_SURFACE_BASELINE_SELF ?? '0'}});
    closeSync(fd);const output=readFileSync(runLog,'utf8');console.info(output.trim()); assert.ifError(checked.error); assert.equal(checked.status,0,output); assert.match(output,/MessageSurface render equivalence PASS/);
  } finally {
    spawnSync('xcrun',['simctl','uninstall',simulator,bundle]); if (!process.env.UI_SURFACE_RENDER_CACHE) rmSync(dir,{recursive:true,force:true});
  }
});
