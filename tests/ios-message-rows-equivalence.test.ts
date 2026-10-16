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
 // The accepted iMessage branch has a fixed 70pt clearance; Original keeps
 // the historical spacer. Preserve identity, edit/copy actions and state owner.
 const userRow = block(user,'func nativeLiveUserMessageRow(');
 assert.match(userRow, /let messageView = NativeLiveUserMessagePresentationView\(presentation:user/);
 assert.match(userRow, /appModel\.nativeLiveMessageUIState\[row\.id\]\.voiceTranscriptExpansion/);
 assert.match(userRow, /onEdit:row\.userBacking\.map \{ message in \{ onEditMessage\(message\) \} \}/);
 assert.match(userRow, /onCopy:onCopyMessage,isDisabled:isTurnInFlight/);
 assert.match(userRow, /if isIMessage \{[\s\S]*?Color\.clear\.frame\(width:leadingClearance\)[\s\S]*?messageView\.frame\(maxWidth:\.infinity,alignment:\.trailing\)/);
 assert.match(userRow, /else \{[\s\S]*?Spacer\(minLength:leadingClearance\)\s*messageView/);
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
 // The Original body and iMessage text/voice paths now live behind the same
 // message presentation. Verify critical actions instead of raw enclosing bytes.
 assert.match(user, /if chatTheme == \.iMessage \{[\s\S]*?NativeLiveIMessageTextBubbleList\(presentation: presentation, side: \.outgoing\)/);
 assert.match(user, /else \{[\s\S]*?textBubble[\s\S]*?\.background\(Color\.chatSoftFill,in:RoundedRectangle/);
 assert.match(user, /LightweightContextMenuInteraction\(title:"Edit",copyText:presentation\.copyText,isDisabled:isDisabled/);
 assert.match(user, /onCopy:onCopy,onTap:toggleVoice,action:onEdit\)/);
 assert.match(user, /guard presentation\.isVoiceInput, presentation\.copyText != nil else \{ return \}/);
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
 assert.ok(compact(route).includes(compact('nativeLiveUserMessageRow(row:row,user:user,appModel:appModel,isTurnInFlight:isTurnInFlight,leadingClearance: chatTheme == .iMessage ? ChatPresentationLayout.iMessageUserLeadingClearance : ChatPresentationLayout.userLeadingClearance,isIMessage: chatTheme == .iMessage,onCopyMessage:onCopyMessage,onEditMessage:onEditMessage)')),
  'Theme-aware user row must preserve edit and copy callback routing');
});
test('Inner renderer remains unchanged and wrong retry target is rejected by conservation',()=>{
 const baseline=old('NativeLiveMessageBlocks.swift'),current=read('NativeLiveMessageBlocks.swift');
 for(const name of ['NativeLiveMessagePresentationView','NativeLiveVisualNodesView','NativeLiveVisualNodeView']) {
  equal(block(current,'struct '+name+':'),block(baseline,'struct '+name+':'),name);
 }
 // The fallback retains its original text and metadata, but the accepted
 // iMessage theme paints the background through a conditional shared modifier.
 const panel = '.modifier(NativeLiveIMessageContentPanel(originalOpacity:0.045,originalCornerRadius:11))';
 const fallback = compact(block(current,'struct NativeLiveVisualFallbackView:'));
 assert.ok(fallback.includes(panel),'Expected theme-aware fallback card background');
 equal(fallback.replace(panel, '.background(Color.primary.opacity(0.045),in:RoundedRectangle(cornerRadius:11))'),
   block(baseline,'struct NativeLiveVisualFallbackView:'), 'Fallback payload, accessibility and Original paint');
 const actions=withoutFooterTimestamp(read('NativeLiveAssistantActions.swift'));
 const wrong=actions.replace('onRetryMessage(user)','onRetryMessage(turn.id)');assert.notEqual(wrong,actions);
 assert.throws(()=>equal(block(wrong,'HStack('),block(old('NativeLiveAssistantTurnRow.swift'),'HStack('),'negative retry target'));
});
test('Message router and assistant preserve routing and presentation order across both themes',()=>{
 const router=compact(block(read('NativeLiveMessageRows.swift'),'var body:'));
 const assistant=compact(block(read('NativeLiveAssistantTurnRow.swift'),'private var content:'));
 const ordered=(source:string,steps:string[],context:string)=>{
  let prior=-1;
  for(const step of steps){
   const at=source.indexOf(compact(step),prior+1);
   assert.ok(at>prior, context+' missing or out of order: '+step);
   prior=at;
  }
 };
 ordered(router,[
  'if row.isHistoryDivider',
  'NativeLiveHistoryForkDivider()',
  'else if let history = row.historyMessage',
  'NativeLiveHistorySnapshotRow(message:history,timeZone:row.historyTimeZone ?? "UTC")',
  'else if let turn = row.assistant',
  'NativeLiveAssistantTurnRow(turn:turn',
  'onCopyMessage:onCopyMessage,onRetryMessage:onRetryMessage,onResolveInteraction:onResolveInteraction)',
  'else if let user = row.user',
  'nativeLiveUserMessageRow(row:row,user:user,appModel:appModel,isTurnInFlight:isTurnInFlight',
  'onCopyMessage:onCopyMessage,onEditMessage:onEditMessage)',
 ],'Row routing and callbacks');
 ordered(assistant,[
  'NativeLiveVisibleThinkingSurface(items: turn.visibleThinking)',
  'activityArea',
  'spotifyResultArea',
  'elevenLabsResultArea',
  'if chatTheme == .iMessage',
  'NativeLiveIMessageTextBubbleList(',
  'else',
  'NativeLiveMessagePresentationView(presentation:turn.bodyPresentation)',
  'MindWriteIndicator(items:mindWrites)',
  'if chatTheme == .original',
  'nativeLiveAssistantActions(turn:turn',
 ],'Assistant sections and Original footer actions');
 assert.match(assistant,/onRetry: retryAction/);
 assert.match(assistant,/isRetryDisabled: isTurnInFlight/);
 assert.match(read('NativeLiveAssistantTurnRow.swift'),/return \{ onRetryMessage\(userID\) \}/);
});
test('UIKit context menu and tap coordinator implementation remains byte identical',()=>{
 const current = read('NativeLiveMessageActions.swift');
 const start = current.indexOf('// The same UIKit context-menu interaction used by user bubbles');
 const end = current.indexOf('private struct NativeLiveCopyFeedbackActionKey:', start);
 assert.ok(start > 0 && end > start, 'Theme-specific assistant context menu boundary');
 // Adding the incoming iMessage context menu must not mutate the existing
 // user bubble coordinator, preview, or copy-feedback action owner.
 assert.equal(current.slice(0, start) + current.slice(end), old('NativeLiveMessageActions.swift'));
 const assistantMenu = current.slice(start, end);
 for (const contract of [
  /UIContextMenuInteraction\(delegate: context\.coordinator\)/,
  /self\?\.onCopy\(original\)/,
  /attributes: self\.isRetryDisabled \? \[\.disabled\] : \[\]/,
  /self\?\.onRetry\?\(\)/,
  /self\?\.onTranslate\(\)/,
  /UIMenu\(title: stamp, options: \.displayInline, children: actions\)/,
 ]) assert.match(assistantMenu, contract);
});
