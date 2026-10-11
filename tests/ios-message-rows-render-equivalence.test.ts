import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync,mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync,openSync,closeSync } from 'node:fs';
import path from 'node:path';import os from 'node:os';import test from 'node:test';
const files=['NativeLiveMessageRows.swift','NativeLiveAssistantTurnRow.swift','NativeLiveMessageBlocks.swift'];
const moved=['NativeLiveUserMessageRow.swift','NativeLiveHistoryMessageRow.swift','NativeLiveHistoryDivider.swift','NativeLiveAssistantActions.swift'];
// Keep historical fixtures immutable. Adapt only the explicitly approved
// process/timestamp geometry; user bubbles, renderers and callbacks stay pinned.
function approvedProcessChrome(s:string, file:string) {
 if(file==='NativeLiveAssistantTurnRow.swift') {
  s=s.replace('Image(systemName:isCopied ? "checkmark" : "square.on.square").frame', 'Image(systemName:isCopied ? "checkmark" : "square.on.square").rotationEffect(.degrees(isCopied ? 0 : 180)).frame');
  s=s.replace('timestampText:turn.timestamp.map { MessageTimestampFormatter.string(from:$0) },header:turn.header,','header:turn.header,');
  s=s.replace(/\} else if let timestamp = turn\.timestamp \{\n                Text\(MessageTimestampFormatter\.string\(from:timestamp\)\)\.font\(\.system\(size:13\.5\)\)\.foregroundStyle\(\.secondary\)\n            \}/, '}');
  s=s.replace('            }\n            NativeLiveMessagePresentationView', '            }.padding(.bottom, turn.stepCount > 0 ? ChatPresentationLayout.processSectionSpacing - ChatPresentationLayout.assistantSpacing : 0)\n            NativeLiveMessagePresentationView');
  s=s.replace('            }.font(.system(size:14))', '                if let timestamp = turn.timestamp {\n                    Text(MessageTimestampFormatter.string(from:timestamp)).font(.system(size:12)).tracking(0.12).foregroundStyle(.secondary)\n                }\n            }.font(.system(size:14))');
 }
 if(file==='NativeLiveMessageRows.swift') {
  const start=s.indexOf('                Text(',s.indexOf('struct NativeLiveHistorySnapshotRow:'));
  const end=s.indexOf('                NativeLiveMessagePresentationView',start);
  const stamp=s.slice(start,end).replace('.padding(.bottom, 4)','.padding(.top, 4)').replace('size: 13.5', 'size: 12').trimEnd();
  s=s.slice(0,start)+s.slice(end);
  const position=s.indexOf('                .textSelection(.enabled)',start)+'                .textSelection(.enabled)'.length;
  s=s.slice(0,position)+'\n\n'+stamp+s.slice(position);
 }
 return s;
}
function instrument(s:string,file:string) {
 s=s.replace('LightweightContextMenuInteraction(title:', 'RowsProbe.context(title:').replace('.onTapGesture { if onEdit == nil', '.rowsTap { if onEdit == nil');
 s=s.replace(/Button \{ (onCopyMessage\(text\)|onRetryMessage\(user\)) \} label: \{ (Image\([^\n]+?) \}/g,(_,action,label)=>`Button(action: RowsProbe.capture("${action.startsWith('onCopy')?'copy':'retry'}", { ${action} })) { ${label}.rowsEnabled("${action.startsWith('onCopy')?'copy':'retry'}") }`);
 if(file==='NativeLiveAssistantTurnRow.swift') s=s.replace('onResolveInteraction:onResolveInteraction)', 'onResolveInteraction:RowsProbe.forward(onResolveInteraction))');
 s=s.replace('.background(Color.chatSoftFill,in:', '.rowsFrame("bubble")\n.background(Color.chatSoftFill,in:');
 s=s.replace('.background(\n                    Color.chatSoftFill,', '.rowsFrame("history-bubble")\n.background(\n                    Color.chatSoftFill,');
 s=s.replace('NativeLiveMessagePresentationView(presentation:turn.bodyPresentation).textSelection(.enabled)', 'NativeLiveMessagePresentationView(presentation:turn.bodyPresentation).textSelection(.enabled).rowsFrame("assistant-body")');
 s=s.replace('}.font(.system(size:14))','}.rowsFrame("actions").font(.system(size:14))');
 s=s.replace('.task(id:turn.canonicalMessageID)', '.rowsFrame("assistant-row")\n.task(id:turn.canonicalMessageID)');
 s=s.replace('.accessibilityElement(children: .combine)', '.rowsFrame("divider")\n.accessibilityElement(children: .combine)');
 return s;
}
test('MessageRows render and callback equivalence against exact main, including negative geometry',{
 skip:process.platform!=='darwin'||!process.env.UI_ROWS_SIMULATOR_ID?'Requires UI_ROWS_SIMULATOR_ID':false,
},()=>{
 const dir=process.env.UI_ROWS_RENDER_CACHE??mkdtempSync(path.join(os.tmpdir(),'leilei-rows-render-'));mkdirSync(dir,{recursive:true});const sim=process.env.UI_ROWS_SIMULATOR_ID!,bundle='com.leileios.tests.rows-equivalence';
 try {
  cpSync('ios/LeileiOS',path.join(dir,'ios'),{recursive:true,filter:p=>!p.includes('xcuserdata')});const root=path.join(dir,'ios/LeileiOS/Chat/MessageSurface');
  // The album badge and its network readback have been explicitly retired.
  // Compare every remaining row pixel/callback with the immutable historical baseline.
  const originals=files.map(f=>readFileSync('tests/fixtures/message-rows-main-72a67f44/'+f,'utf8')
    .replace('AlbumSaveIndicator(count:turn.parentUserMessageID.flatMap { appModel.albumSavesByUserMessageID[$0]?.total } ?? 0)', '')
    .replace('if let user = turn.parentUserMessageID { await appModel.refreshAlbumSaves(userMessageID:user,force:isCurrentHead) }', '')).map((source,i)=>approvedProcessChrome(source,files[i]));
  const names=new Set(originals.flatMap(s=>[...s.matchAll(/\b(?:struct|class|enum|protocol)\s+(\w+)/g)].map(m=>m[1])));
  for(const f of [...files,...moved])writeFileSync(path.join(root,f),instrument(readFileSync('ios/LeileiOS/LeileiOS/Chat/MessageSurface/'+f,'utf8'),f));
  for(let i=0;i<files.length;i++)writeFileSync(path.join(root,'Baseline'+files[i]),instrument(originals[i],files[i]).replace(new RegExp('\\b('+[...names].join('|')+')\\b','g'),n=>'Baseline'+n));
  // The actual baseline user content, with one deliberate inset error.
  let rejected=originals[2].replaceAll('ChatPresentationLayout.bubbleHorizontalInset','(ChatPresentationLayout.bubbleHorizontalInset + 1)');
  assert.notEqual(rejected,originals[2]);rejected=instrument(rejected,files[2]).replace(new RegExp('\\b('+[...names].join('|')+')\\b','g'),n=>'Rejected'+n);writeFileSync(path.join(root,'RejectedMessageBlocks.swift'),rejected);
  writeFileSync(path.join(dir,'ios/LeileiOS/App/LeileiOSApp.swift'),readFileSync('tests/fixtures/ios-message-rows-render-equivalence.swift','utf8'));
  const build=spawnSync('xcodebuild',['-project',path.join(dir,'ios/LeileiOS.xcodeproj'),'-scheme','LeileiOS','-sdk','iphonesimulator','-destination','generic/platform=iOS Simulator','-derivedDataPath',path.join(dir,'build'),'CODE_SIGNING_ALLOWED=NO',`PRODUCT_BUNDLE_IDENTIFIER=${bundle}`,'build'],{encoding:'utf8',timeout:600000,maxBuffer:30_000_000});writeFileSync(path.join(dir,'build.log'),build.stdout+build.stderr);assert.equal(build.status,0,(build.stdout+build.stderr).split('\n').filter(l=>l.includes('error:')).join('\n'));
  const install=spawnSync('xcrun',['simctl','install',sim,path.join(dir,'build/Build/Products/Debug-iphonesimulator/LeileiOS.app')],{encoding:'utf8'});assert.equal(install.status,0,install.stderr);
  const fd=openSync(path.join(dir,'run.log'),'w');const run=spawnSync('xcrun',['simctl','launch','--console','--terminate-running-process',sim,bundle],{stdio:['ignore',fd,fd],timeout:600000,env:{...process.env,SIMCTL_CHILD_ROWS_NEGATIVE:process.env.UI_ROWS_NEGATIVE??'0'}});closeSync(fd);const output=readFileSync(path.join(dir,'run.log'),'utf8');console.info(output.trim());assert.ifError(run.error);assert.equal(run.status,0,output);assert.match(output,/MessageRows equivalence PASS/);
 } finally {spawnSync('xcrun',['simctl','uninstall',sim,bundle]);if(!process.env.UI_ROWS_RENDER_CACHE)rmSync(dir,{recursive:true,force:true});}
});
