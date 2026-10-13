import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
const root='ios/LeileiOS/LeileiOS/Chat/MessageSurface/';
const fixture='tests/fixtures/message-rows-main-72a67f44/';
const read=(name:string)=>readFileSync(root+name,'utf8');
const old=(name:string)=>readFileSync(fixture+name,'utf8');
// Keep immutable historical blobs. Only the explicitly retired album seams are excluded.
const withoutRetiredAlbum=(s:string)=>s
 .replace('AlbumSaveIndicator(count:turn.parentUserMessageID.flatMap { appModel.albumSavesByUserMessageID[$0]?.total } ?? 0)', '')
 .replace('if let user = turn.parentUserMessageID { await appModel.refreshAlbumSaves(userMessageID:user,force:isCurrentHead) }', '');
// Only approved footer timestamp and action-glyph styling are excluded from historical
// callback conservation. Copy/retry targets, order and disabled remain exact.
const withoutFooterTimestamp=(s:string)=>s.replaceAll('height:ChatPresentationLayout.actionDiameter,alignment:.leading)', 'height:ChatPresentationLayout.actionDiameter)').replaceAll('.font(.system(size:14,weight:.light))', '').replace('.rotationEffect(.degrees(20))', '').replace('.rotationEffect(.degrees(isCopied ? 0 : 180))', '').replace(/\n        if let timestamp = turn\.(?:timestamp|visibleTimestamp) \{[\s\S]*?\n        \}/, '');
const compact=(s:string)=>s.replace(/\s/g,'');
function block(s:string,marker:string) {
 const start=s.indexOf(marker);assert.notEqual(start,-1,marker);const open=s.indexOf('{',start);let depth=1,end=open+1;
 for(;depth && end<s.length;end++){if(s[end]==='{')depth++;if(s[end]==='}')depth--;}
 assert.equal(depth,0);return s.slice(open+1,end-1);
}
const equal=(a:string,b:string,label:string)=>assert.equal(compact(a),compact(b),label);
test('Message row baseline fixtures are exact main Git blobs',()=>{
 const manifest=JSON.parse(readFileSync(fixture+'blobs.json','utf8'));
 assert.equal(manifest.commit,'72a67f4422368156dca75f44e3b97fc2143123c4');
 for(const [file,sha] of Object.entries(manifest.files)) {
  const content=readFileSync(fixture+file);assert.equal(createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex'),sha,file);
 }
});
test('User row and history/divider moves retain complete presentation and interaction blocks',()=>{
 const baseline=old('NativeLiveMessageRows.swift');const user=read('NativeLiveUserMessageRow.swift');
 equal(block(user,'func nativeLiveUserMessageRow('),block(baseline.slice(baseline.indexOf('} else if let user = row.user')), 'HStack(').replace(/^/,'HStack(alignment:.top,spacing:0) {')+'}', 'user outer HStack');
 for(const name of ['NativeLiveHistorySnapshotRow','NativeLiveHistoryForkDivider']) {
  let expected=block(baseline,'struct '+name+':');
  if(name==='NativeLiveHistorySnapshotRow') {
   const start=expected.indexOf('                Text('), end=expected.indexOf('                NativeLiveMessagePresentationView',start);
   const stamp=expected.slice(start,end).replace('.padding(.bottom, 4)','.padding(.top, 4)').replace('size: 13.5', 'size: 12').trimEnd();
   expected=expected.slice(0,start)+expected.slice(end);
   const position=expected.indexOf('                .textSelection(.enabled)',start)+'                .textSelection(.enabled)'.length;
   expected=expected.slice(0,position)+'\n\n'+stamp+expected.slice(position);
  }
  equal(block(read(name==='NativeLiveHistorySnapshotRow'?'NativeLiveHistoryMessageRow.swift':'NativeLiveHistoryDivider.swift'),'struct '+name+':'),expected,name);
 }
 // Compact voice geometry changed intentionally; normalize only that presentation seam.
 const normalized=user
   .replace(
     '.padding(.leading, usesCompactVoiceInsets ? NativeLiveVoiceBubbleGeometry.userLeadingInset : ChatPresentationLayout.bubbleHorizontalInset)\n                    .padding(.trailing, usesCompactVoiceInsets ? NativeLiveVoiceBubbleGeometry.userTrailingInset : ChatPresentationLayout.bubbleHorizontalInset)\n                    .padding(.vertical,ChatPresentationLayout.bubbleVerticalInset)',
     '.padding(.horizontal,ChatPresentationLayout.bubbleHorizontalInset).padding(.vertical,ChatPresentationLayout.bubbleVerticalInset)',
   )
   .replace(/\n    private var usesCompactVoiceInsets: Bool \{[\s\S]*?\n    \}\n\n    @ViewBuilder private var textBubble:/, '\n    @ViewBuilder private var textBubble:')
   .replace('VStack(alignment:.trailing,spacing:10) {\n                NativeLiveVoiceMessageBubbleVisual(isExpanded:isVoiceTranscriptRevealed, transcript:presentation.copyText)', 'VStack(alignment:.leading,spacing:10) {\n                NativeLiveVoiceMessageBubbleVisual(isExpanded:isVoiceTranscriptRevealed)');
 equal(block(normalized,'struct NativeLiveUserMessagePresentationView:'),block(old('NativeLiveMessageBlocks.swift'),'struct NativeLiveUserMessagePresentationView:'),'entire user presentation except compact voice geometry');
});
test('Assistant organization conserves activity bindings, refresh owner, indicators and action routes',()=>{
 const baseline=old('NativeLiveAssistantTurnRow.swift'),current=read('NativeLiveAssistantTurnRow.swift');
 for(const exact of ['projection:turn.activityProjection', 'expansion:Binding(get:{ appModel.nativeLiveMessageUIState[turn.id] },set:{ appModel.nativeLiveMessageUIState[turn.id] = $0 })', 'onResolveInteraction:onResolveInteraction']) assert.ok(compact(block(current,'private var activityArea:')).includes(compact(exact)),exact);
 equal(block(current,'.task(id:turn.canonicalMessageID)'),withoutRetiredAlbum(block(baseline,'.task(id:turn.canonicalMessageID)')), 'Mind refresh order/head/IDs');
 equal(block(current,'private var mindWrites:'),block(baseline,'private var mindWrites:'),'Mind lookup');
 // 2e6505e0 hides the footer while generating; pin the accepted footer itself
 // before comparing the unchanged copy/retry actions against their old bodies.
 const footer=read('NativeLiveAssistantActions.swift');
 equal(block(footer,'if let timestamp = turn.visibleTimestamp'),
   'Text(MessageTimestampFormatter.string(from:timestamp)).font(.system(size:12)).tracking(0.12).foregroundStyle(.secondary)',
   'Accepted generation-aware footer timestamp');
 assert.doesNotMatch(footer,/if let timestamp = turn\.timestamp/);
 const rawAction=withoutFooterTimestamp(footer);
 const action=process.env.ROWS_CALLBACK_NEGATIVE ? rawAction.replace('onRetryMessage(user)','onRetryMessage(turn.id)'):rawAction;
 equal(block(action,'HStack('),block(baseline,'HStack('),'copy and retry callbacks/targets/order/disabled');
 assert.ok(compact(action).includes(compact('}.font(.system(size:14)).foregroundStyle(.secondary).buttonStyle(.plain).padding(.top,ChatPresentationLayout.actionTopInset)')));
 for(const exact of ['NativeLiveMessagePresentationView(presentation:turn.bodyPresentation).textSelection(.enabled)','MindWriteIndicator(items:mindWrites)']) assert.ok(compact(current).includes(compact(exact)),exact);
 assert.doesNotMatch(current, /AlbumSaveIndicator|refreshAlbumSaves/);
 const route=read('NativeLiveMessageRows.swift');
 assert.ok(compact(route).includes(compact('nativeLiveUserMessageRow(row:row,user:user,appModel:appModel,isTurnInFlight:isTurnInFlight,onCopyMessage:onCopyMessage,onEditMessage:onEditMessage)')));
});
test('Inner renderer remains unchanged and wrong retry target is rejected by conservation',()=>{
 const baseline=old('NativeLiveMessageBlocks.swift'),current=read('NativeLiveMessageBlocks.swift');
 for(const name of ['NativeLiveMessagePresentationView','NativeLiveVisualNodesView','NativeLiveVisualNodeView','NativeLiveVisualFallbackView']) equal(block(current,'struct '+name+':'),block(baseline,'struct '+name+':'),name);
 const actions=withoutFooterTimestamp(read('NativeLiveAssistantActions.swift'));
 const wrong=actions.replace('onRetryMessage(user)','onRetryMessage(turn.id)');assert.notEqual(wrong,actions);
 assert.throws(()=>equal(block(wrong,'HStack('),block(old('NativeLiveAssistantTurnRow.swift'),'HStack('),'negative retry target'));
});
test('Full router and assistant body recompose to the original ordered blocks',()=>{
 const baseline=old('NativeLiveMessageRows.swift'),current=read('NativeLiveMessageRows.swift');
 const routed=block(current,'var body:').replace(/nativeLiveUserMessageRow\([\s\S]*?onEditMessage:onEditMessage\)/,block(read('NativeLiveUserMessageRow.swift'),'func nativeLiveUserMessageRow('));
 equal(routed,block(baseline,'var body:'),'row routing, IDs and every forwarded input');
 const assistant=read('NativeLiveAssistantTurnRow.swift');
 // The new optional Spotify slot is verified separately; conserve all existing blocks.
 const composed=block(assistant,'var body:').replace(/\n                \.padding\(\.bottom, processSections\.[^\n]+/g, '').replace(/if processSections\.showsLoading \{[\s\S]*?\n            \}/, '').replace('spotifyResultArea','').replace('elevenLabsResultArea','').replace('NativeLiveVisibleThinkingSurface(items: turn.visibleThinking)','').replace('activityArea',block(old('NativeLiveAssistantTurnRow.swift'),'VStack(alignment:.leading,spacing:ChatPresentationLayout.assistantSpacing)').split('NativeLiveMessagePresentationView')[0]).replace(/nativeLiveAssistantActions\([\s\S]*?onRetryMessage:onRetryMessage\)/,block(withoutFooterTimestamp(read('NativeLiveAssistantActions.swift')),'func nativeLiveAssistantActions('));
 equal(composed,withoutRetiredAlbum(block(old('NativeLiveAssistantTurnRow.swift'),'var body:')),'assistant entire ordered body and task except retired album');
});
test('UIKit context menu and tap coordinator implementation remains byte identical',()=>{
 assert.equal(read('NativeLiveMessageActions.swift'),old('NativeLiveMessageActions.swift'));
});
