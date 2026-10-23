import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withoutSwiftPaint } from './helpers/swift-paint.js';
const root='ios/LeileiOS/LeileiOS/Chat/';
const fixture='tests/fixtures/message-surface-main-52c957c1/';
const baseline=readFileSync(fixture+'NativeLiveMessageSurface.swift','utf8');
const compact=(s:string)=>s.replace(/\/\/[^\n]*/g,'').replace(/\s+/g,'');
function block(s:string,marker:string) {
  const start=s.indexOf(marker);assert.ok(start>=0,marker);
  const open=s.indexOf('{',start);let end=open+1,depth=1;
  for (;depth && end<s.length;end++) { if(s[end]==='{')depth++;else if(s[end]==='}')depth--; }
  assert.equal(depth,0,marker);return compact(s.slice(open+1,end-1));
}
const blob=(s:Buffer)=>createHash('sha1').update(`blob ${s.length}\0`).update(s).digest('hex');
// Only the intentional native scrolling wrapper around status content is new.
// Its inner content and every existing observer/action remain exact comparisons.
function withoutStatusScrollWrappers(source:string) {
  let result=source;
  for(let start=result.indexOf('Self.scrollableState {');start>=0;start=result.indexOf('Self.scrollableState {')) {
    const open=result.indexOf('{',start);let end=open+1,depth=1;
    for(;depth && end<result.length;end++) {if(result[end]==='{')depth++;else if(result[end]==='}')depth--;}
    assert.equal(depth,0,'status scroll wrapper');
    result=result.slice(0,start)+result.slice(open+1,end-1)+result.slice(end);
  }
  return result;
}
test('MessageSurface fixtures are exact blobs from main@52c957c1',()=>{
  const manifest=JSON.parse(readFileSync(fixture+'blobs.json','utf8'));
  for(const [file,sha] of Object.entries(manifest)) assert.equal(blob(readFileSync(fixture+file)),sha,file);
});
test('MessageSurface conserves every observer, state owner, callback body and scroll command order',()=>{
  const current=readFileSync(root+'NativeLiveMessageSurface.swift','utf8');
  for(const marker of ['private var syncUnavailable:','private func captureReplacementAnchor(','private func captureAnchor(','private func copyMessage(','private func showCopyFeedback(','private func scrollToBottom(']) {
    assert.equal(block(withoutStatusScrollWrappers(current),marker),block(baseline,marker),marker);
  }
  // Compare complete ordered modifier chain, including transform/action,
  // preference restoration and both lifecycle handlers, not isolated guards.
  // Approved iMessage clips the scroll surface while Original remains
  // unclipped. Every modifier/observer after this presentation choice is pinned.
  const observers=(s:string)=>compact(s.slice(s.indexOf('.scrollClipDisabled('),s.indexOf('.overlay(alignment: .top)')));
  // Only forward growth from a previously bottom-anchored viewport:
  // transient canonical/optimistic shrinkage must not force a second jump.
  const boundedFollow = 'metrics.height>old.height&&old.nearBottom&&scrollState.shouldFollowContent&&preservedAnchor==nil';
  const priorFollow = 'old.height!=metrics.height&&scrollState.shouldFollowContent&&preservedAnchor==nil';
  assert.ok(observers(current).includes(boundedFollow),'follow only positive growth at the previous bottom');
  assert.equal(observers(current)
    .replace('.scrollClipDisabled(chatTheme!=.iMessage)', '.scrollClipDisabled()')
    .replace(boundedFollow,priorFollow),observers(baseline));
  const declarations=(s:string)=>compact(s.slice(s.indexOf('@EnvironmentObject'),s.indexOf('var body:')));
  assert.equal(declarations(current).replace('@Environment(\\.chatTheme)privatevarchatTheme',''),declarations(baseline));
  assert.match(current, /if !isAuthenticated \{\s*Self\.scrollableState \{ AppStateSurface\(title: "Sign in"\) \}/);
  assert.match(current, /else if pendingOperation != nil \{\s*messageList\(snapshot\)/);
  assert.match(current, /case \.content: messageList\(snapshot\)/);
  assert.match(current, /\.background\(chatTheme == \.iMessage \? Color\.clear : Color\(\.systemBackground\)\)/);
  assert.match(current, /\.scrollDismissesKeyboard\(\.interactively\)/);
  const actions=(s:string)=>[...s.matchAll(/Button \{([\s\S]*?)\} label:/g)].map(m=>compact(m[1]));
  assert.deepEqual(actions(current),actions(baseline),'return then older action bodies, guard/Task/await order');
  const predicate=(s:string)=>compact(s.slice(s.indexOf('if snapshot?.olderCursor'),s.indexOf('Button {',s.indexOf('if snapshot?.olderCursor'))));
  assert.equal(predicate(current),predicate(baseline));
  for(const modifier of ['.disabled(','.id("native-live-load-older")']) assert.ok(current.includes(modifier));
  const keyCurrent=(current+readFileSync(root+'MessageSurface/NativeLiveMessageList.swift','utf8'));
  assert.equal(block(keyCurrent,'struct NativeLiveRowFramesKey:'),block(baseline,'struct NativeLiveRowFramesKey:'));
  const list=readFileSync(root+'MessageSurface/NativeLiveMessageList.swift','utf8');
  const oldList=block(baseline,'LazyVStack(');
  const newList=block(list,'LazyVStack(').replaceAll('pagination()', 'loadOlderButton(snapshot)').replaceAll('onCopyMessage($0,row.id)','copyMessage($0,messageID:row.id)').replaceAll('currentHeadMessageID','snapshot?.currentHeadMessageId');
  assert.match(list, /rowSpacing: CGFloat = ChatPresentationLayout\.turnSpacing/);
  assert.match(current, /rowSpacing: chatTheme == \.iMessage \? ChatPresentationLayout\.iMessageTurnSpacing : ChatPresentationLayout\.turnSpacing/);
  assert.equal(newList,oldList,'row identity, measurements, order, pagination slots and bottom anchor');
});
// Chrome appearance (insets, offsets, spacing, fonts) is owner-tuned; its
// content, accessibility and transitions stay conserved.
test('Moved chrome retains its content, accessibility and transition ownership',()=>{
  const current=readFileSync(root+'NativeLiveMessageSurface.swift','utf8');
  const chrome=readFileSync(root+'MessageSurface/NativeLiveMessageSurfaceChrome.swift','utf8');
  const unpainted=(s:string)=>compact(withoutSwiftPaint(s));
  const payload=(name:string)=>unpainted(block(chrome.slice(chrome.indexOf('struct '+name)), 'var body:'));
  const copyStart=baseline.indexOf('HStack(spacing: 8)',baseline.indexOf('.overlay(alignment: .top)'));
  const copy=unpainted(baseline.slice(copyStart,baseline.indexOf('.transition(',copyStart))).replace('Text(copyFeedbackText)','Text(text)');
  assert.equal(payload('NativeLiveCopyFeedbackBanner'),copy);
  const arrowStart=baseline.indexOf('Image(systemName: "arrow.down")');
  assert.equal(payload('NativeLiveReturnToBottomGlyph'),unpainted(baseline.slice(arrowStart,baseline.indexOf('}\n                    .buttonStyle',arrowStart))));
  const olderStart=baseline.indexOf('HStack(spacing: 8)',baseline.indexOf('private func loadOlderButton'));
  assert.equal(payload('NativeLivePaginationLabel'),unpainted(baseline.slice(olderStart,baseline.indexOf('}\n            .buttonStyle',olderStart))));
  for(const marker of ['.overlay(alignment: .top)', '.overlay(alignment: .bottom)']) assert.ok(current.includes(marker));
  for(const modifier of ['.scale(scale: 0.9)', '.move(edge: .top)', '.accessibilityLabel("Scroll to latest")']) assert.ok(current.includes(modifier));
});
test('actual main/current scroll states have identical transitions; a wrong follow condition is rejected', {skip:process.platform!=='darwin'},()=>{
  const old=readFileSync(fixture+'MessageSurface/NativeLiveConversationScrollState.swift','utf8');
  const current=readFileSync(root+'MessageSurface/NativeLiveConversationScrollState.swift','utf8');
  assert.equal(current,old,'state implementation must remain byte-identical');
  const bad=current.replace('followLatest && !userIsInteracting','followLatest || userIsInteracting');assert.notEqual(bad,current);
  const renamed=(s:string,prefix:string)=>s.replaceAll('NativeLiveConversationScrollState',prefix+'State').replaceAll('NativeLiveConversationLoadPresentation',prefix+'Load');
  const dir=mkdtempSync(path.join(os.tmpdir(),'surface-state-'));
  try {
    // Execute compiled production implementations, record after EVERY event,
    // commands at content changes and anchor restoration, including yield slot.
    let code=renamed(old,'Baseline')+'\n'+renamed(current,'Current')+'\n'+renamed(bad,'Rejected');
    const trace=(prefix:string)=>`func trace${prefix}(_ events:[Int])->[String] {
      var s=${prefix}State();var log=[String]();var anchor:${prefix}State.Anchor?;let id=UUID(uuidString:"00000000-0000-0000-0000-000000000001")!
      for (step,e) in events.enumerated() {
        switch e {
        case 0:s.geometryChanged(isNearBottom:false)
        case 1:s.geometryChanged(isNearBottom:true)
        case 2:s.interactionChanged(true)
        case 3:s.interactionChanged(false)
        case 4:if s.shouldFollowContent { log.append("schedule@\\(step)"); if s.shouldFollowContent {log.append("yield:scroll:bottom@\\(step)")} }
        case 5:log.append("replacement:\\(s.beginReplacement(id))");anchor = .init(stableID:"old",relativeOffset:37)
        case 6:anchor=s.preservedAnchor(before:anchor,survivingIDs:["new"],replacementID:"new");if let a=anchor { log.append("restore:\\(a.stableID):\\(a.relativeOffset)@\\(step)") };anchor=nil
        case 7:anchor = .init(stableID:"old",relativeOffset:37);log.append("pagination:capture@\\(step)")
        case 8:anchor=s.preservedAnchor(before:anchor,survivingIDs:["old"]);if let a=anchor {log.append("pagination:restore:\\(a.stableID):\\(a.relativeOffset)@\\(step)")};anchor=nil
        case 9:s.sentNewMessage();log.append("send:bottom@\\(step)")
        default:s.returnToBottom();log.append("return:bottom@\\(step)")
        }
        log.append("\\(step):\\(s.isNearBottom):\\(s.followLatest):\\(s.userIsInteracting):\\(s.shouldFollowContent):\\(s.shouldShowReturnToBottom):\\(s.replacementOperationID != nil)")
      };return log
    }`;
    code+='\n'+['Baseline','Current','Rejected'].map(trace).join('\n')+`
    var cases=0;var caught=0
    let sequences=[[4],[2,0,3,4,10,4],[2,0,3,7,8,4],[2,0,3,5,6,4],[2,1,3,4],[0,9,4],[5,5,6],[2,0,4,3,4,10]]
    for events in sequences {precondition(traceBaseline(events)==traceCurrent(events));if traceBaseline(events) != traceRejected(events){caught+=1};cases+=1}
    for a in 0...10 {for b in 0...10 {for c in 0...10 {let events=[a,b,c,4];precondition(traceBaseline(events)==traceCurrent(events));if traceBaseline(events) != traceRejected(events){caught+=1};cases+=1}}}
    precondition(caught>0);print("Scroll state equivalence PASS: \\(cases) sequences; wrong follow rejected in \\(caught)")
    if ProcessInfo.processInfo.environment["SURFACE_BEHAVIOR_NEGATIVE"] == "1" {precondition(traceBaseline([2,0,3,4])==traceRejected([2,0,3,4]),"negative follow condition")}
    `;
    const file=path.join(dir,'main.swift');writeFileSync(file,code);
    const build=spawnSync('xcrun',['swiftc','-module-cache-path',path.join(dir,'modules'),file,'-o',path.join(dir,'states')],{encoding:'utf8',timeout:60_000});assert.equal(build.status,0,build.stderr);
    const run=spawnSync(path.join(dir,'states'),[],{encoding:'utf8',env:process.env});console.info(run.stdout);assert.equal(run.status,0,run.stderr);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
