import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
const media='ios/LeileiOS/LeileiOS/Chat/MessageSurface/';
function closing(s:string,open:number) {
 let depth=1,quoted=false;
 for(let i=open+1;i<s.length;i++){ if(s[i]==='"' && s[i-1]!=='\\') quoted=!quoted; if(quoted)continue; if(s[i]==='{')depth++; if(s[i]==='}' && --depth===0)return i; }
 throw new Error('Unbalanced Swift');
}
function instrument(source:string) {
 source=source.replace(/((?:private )?struct \w+: View \{)/g, '$1\n    @Environment(\\.stage6Scope) private var probeScope');
 // Capture real actions in test-only copies; the original closure body is executed.
 const matches=[...source.matchAll(/Button(?:\([^\n]*?\))?\s*\{/g)];
 for(let i=matches.length-1;i>=0;i--){ const start=matches[i].index!,open=source.indexOf('{',start),end=closing(source,open); const action=source.slice(open+1,end);
  const prefix=source.slice(start,open).trim();
  const key=prefix.includes('"Retry"')?'retry':prefix.includes('"Allow"')?'allow':prefix.includes('"Deny"')?'deny':action.includes('playOrPause')?'play':action.includes('open()')?'open':action.includes('openURL')?'url-\\(entity.name)':action.includes('isShowingDetails')?'details':`button${i}`;
  if(prefix !== 'Button') {
   source=source.slice(0,start)+prefix.slice(0,-1)+`, action: Stage6Probe.capture("${key}", scope: probeScope, {${action}}))`+source.slice(end+1); continue;
  }
  const labelOpen=source.indexOf('{',end+1), labelEnd=closing(source,labelOpen);
  source=source.slice(0,start)+`Button(action: Stage6Probe.capture("${key}", scope: probeScope, {${action}}), label: {`+source.slice(labelOpen+1,labelEnd)+`}).stage6Frame("${key}")`+source.slice(labelEnd+1);
 }
 return source;
}
test('Audio/Spotify actual simulator snapshots, compiled actions and non-target main equivalence', {
 skip:process.platform !== 'darwin' || !process.env.UI_STAGE6_SIMULATOR_ID ? 'Requires UI_STAGE6_SIMULATOR_ID' : false,
},async()=>{
 const dir=process.env.UI_STAGE6_RENDER_CACHE ?? mkdtempSync(path.join(os.tmpdir(),'stage6-render-'));
 const server=spawn(process.execPath,['--input-type=module','-e',`import {createServer} from 'node:http'; const png=Buffer.from('${readFileSync('tests/fixtures/stage6-cover.png').toString('base64')}','base64'); const s=createServer((q,r)=>{if(q.url==='/cover.png'){r.setHeader('Content-Type','image/png');r.end(png);}else{r.writeHead(404);r.end();}});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`],{stdio:['ignore','pipe','pipe']});
 const port=await new Promise<string>((resolve,reject)=>{server.stdout.once('data',b=>resolve(b.toString().trim()));server.once('error',reject);});
 const sim=process.env.UI_STAGE6_SIMULATOR_ID!, bundle='com.leileios.tests.stage6'; mkdirSync(dir,{recursive:true});
 try {
  cpSync('ios/LeileiOS',path.join(dir,'ios'),{recursive:true,filter:p=>!p.includes('xcuserdata')});
  const root=path.join(dir,'ios/LeileiOS/Chat/MessageSurface');
  // Test-only localhost image server; production Info.plist is untouched.
  const plist=path.join(dir,'ios/LeileiOS/Info.plist');
  writeFileSync(plist,readFileSync(plist,'utf8').replace('</dict>\n</plist>','<key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/></dict>\n</dict>\n</plist>'));
  const files=['NativeLiveMediaRenderer.swift','NativeLiveSVGRenderer.swift','NativeLiveToolActivity.swift'];
  const rename=(s:string)=>s.replace(/\b(NativeLiveMediaLoadState|NativeLiveMediaRenderer|NativeLiveMediaGrid|NativeLiveMediaCard|NativeLiveSVGLoadState|NativeLiveSVGRenderer|NativeLiveRegisteredAttachmentView|NativeLiveToolActivityRow|NativeLiveToolCallCard|NativeLiveToolResultCard)\b/g,'Baseline$1');
  function freeze(s:string) {
   s=s.replace('@Published var image: UIImage?','@Published var image: UIImage? = Stage6Probe.image');
   s=s.replace(/appModel.nativeLiveAttachmentBytes\((input|descriptor)\)/g,'Stage6Probe.bytes($1)');
   let at=s.indexOf('.task(id:');
   while(at>=0){ const open=s.indexOf('{',at),end=closing(s,open); s=s.slice(0,at)+'.task {}'+s.slice(end+1); at=s.indexOf('.task(id:'); }
   return s;
  }
  for(const file of files){
   const current=readFileSync(media+file,'utf8');
   const previous={stdout:readFileSync('tests/fixtures/media-tools-main-f98414a9/'+file,'utf8')};
   writeFileSync(path.join(root,file),instrument(freeze(current)));
   let baseline=previous.stdout;
   if(file==='NativeLiveToolActivity.swift') baseline=baseline.replace(/enum NativeLiveToolCallState: Equatable \{[\s\S]*?\n\}/,'');
   writeFileSync(path.join(root,'Baseline'+file),rename(instrument(freeze(baseline))));
  }
  writeFileSync(path.join(root,'NativeLiveInteractions.swift'),instrument(readFileSync(media+'NativeLiveInteractions.swift','utf8')));
  let audio=readFileSync(media+'NativeLiveAudioAttachmentBubble.swift','utf8').replaceAll('appModel.nativeLiveAttachmentBytes(input)','Stage6Probe.bytes(input)');
  audio=audio.replace('mimeType: input.mimeType)', 'mimeType: input.mimeType, root: Stage6Probe.mode == "preview" ? URL(fileURLWithPath: "/dev/null") : NativeLiveFilePreviewLease.defaultRoot)');
  audio=audio.replace('let preview = try NativeLiveFilePreviewLease', 'Stage6Probe.previewCreations += 1; let preview = try NativeLiveFilePreviewLease');
  audio=instrument(audio).replace('Button("Retry") { retry() }','Button("Retry", action: Stage6Probe.capture("retry", scope: probeScope, { retry() }))');
  audio += '\nextension NativeLiveAudioAttachmentBubble { init(stage6Input: NativeLiveAttachmentPresentationInput, state: NativeLiveAudioPlaybackState) { input = stage6Input; _playback = StateObject(wrappedValue: state) } }\n';
  audio=audio.replace('.onDisappear { playback.deactivate() }','.onDisappear { playback.deactivate() }.onAppear { Stage6Probe.lease = { lease }; Stage6Probe.dismiss = { lease?.cleanup(); lease = nil } }');
  if(process.env.UI_STAGE6_MUTATION==='play-open') audio=audio.replace('Button(action: Stage6Probe.capture("play", scope: probeScope, { playOrPause() }), label:','Button(action: Stage6Probe.capture("play", scope: probeScope, { open() }), label:');
  if(process.env.UI_STAGE6_MUTATION==='padding') audio=audio.replace('.padding(8)','.padding(9)');
  writeFileSync(path.join(root,'NativeLiveAudioAttachmentBubble.swift'),audio);
  let user=readFileSync(media+'NativeLiveUserMessageRow.swift','utf8')
    .replace('.foregroundStyle(.primary)', '.foregroundStyle(.primary).stage6Frame("voice-waveform")')
    .replace('.foregroundStyle(.secondary)', '.foregroundStyle(.secondary).stage6Frame("voice-chevron")')
    .replace('.accessibilityElement(children: .ignore)', '.stage6Frame("voice-controls").accessibilityElement(children: .ignore)')
    .replace('.background(Color.chatSoftFill,in:', '.stage6Frame("voice-bubble").background(Color.chatSoftFill,in:');
  const anchored=process.env.VOICE_VISUAL_MUTATION==='user-anchor' ? user.replace('Image(systemName: isExpanded ?', 'Spacer(minLength: 0); Image(systemName: isExpanded ?').replace('.frame(width: NativeLiveVoiceBubbleGeometry.userWidth(transcript: transcript), alignment: .trailing)', '.frame(width: NativeLiveVoiceBubbleGeometry.userWidth(transcript: transcript), alignment: .leading)') : user;
  writeFileSync(path.join(root,'NativeLiveUserMessageRow.swift'),anchored);
  writeFileSync(path.join(root,'NativeLiveAudioPlaybackState.swift'),readFileSync(media+'NativeLiveAudioPlaybackState.swift','utf8').replace(/private\(set\)/g,''));
  writeFileSync(path.join(root,'NativeLiveSpotifyCard.swift'),instrument(readFileSync(media+'NativeLiveSpotifyCard.swift','utf8').replace('image.resizable().scaledToFill()', 'image.resizable().scaledToFill().onAppear { Stage6Probe.coversLoaded += 1 }')));
  cpSync('tests/fixtures/spotify-sdk-output.json',path.join(dir,'ios/LeileiOS/spotify-sdk-output.json'));
  writeFileSync(path.join(dir,'ios/LeileiOS/App/LeileiOSApp.swift'),readFileSync('tests/fixtures/ios-audio-spotify-render.swift','utf8').replaceAll(':18766/', ':'+port+'/'));
  const built=spawnSync('xcodebuild',['-project',path.join(dir,'ios/LeileiOS.xcodeproj'),'-scheme','LeileiOS','-sdk','iphonesimulator','-destination','generic/platform=iOS Simulator','-derivedDataPath',path.join(dir,'build'),'CODE_SIGNING_ALLOWED=NO',`PRODUCT_BUNDLE_IDENTIFIER=${bundle}`,'build'],{encoding:'utf8',timeout:600000,maxBuffer:30_000_000});
  writeFileSync(path.join(dir,'build.log'),built.stdout+built.stderr); assert.equal(built.status,0,(built.stdout+built.stderr).split('\n').filter(l=>l.includes('error:')).join('\n'));
  assert.equal(spawnSync('xcrun',['simctl','install',sim,path.join(dir,'build/Build/Products/Debug-iphonesimulator/LeileiOS.app')]).status,0);
  const fd=openSync(path.join(dir,'run.log'),'w');
  const run=spawnSync('xcrun',['simctl','launch','--console','--terminate-running-process',sim,bundle],{stdio:['ignore',fd,fd],timeout:600000,env:{...process.env,SIMCTL_CHILD_STAGE6_MUTATION:process.env.UI_STAGE6_MUTATION ?? 'none',SIMCTL_CHILD_STAGE6_BEHAVIOR_ONLY:process.env.UI_STAGE6_BEHAVIOR_ONLY ?? '0',SIMCTL_CHILD_STAGE6_FOCUS:process.env.UI_STAGE6_FOCUS ?? ''}}); closeSync(fd);
  const output=readFileSync(path.join(dir,'run.log'),'utf8'); console.info(output.trim()); assert.ifError(run.error); assert.equal(run.status,0,output); assert.match(output,/Stage6 render PASS/);
  if(process.env.UI_STAGE6_BEHAVIOR_ONLY==='1') return;
  const container=spawnSync('xcrun',['simctl','get_app_container',sim,bundle,'data'],{encoding:'utf8'}); assert.equal(container.status,0);
  const snapshotRoot=path.join(container.stdout.trim(),'Documents/Stage6Snapshots');
  const device=output.includes('device=iPad')?'ipad':'iphone';
  cpSync(snapshotRoot,path.join(dir,'snapshots'),{recursive:true});
  const recorded=JSON.parse(readFileSync(path.join(snapshotRoot,'manifest.json'),'utf8'));
  const approved='tests/fixtures/stage6-snapshots/'+device;
  assert.ok(!(process.env.UI_STAGE6_RECORD==='1' && process.env.UI_STAGE6_FOCUS),'Record requires the full matrix');
  const original=JSON.parse(readFileSync(path.join(approved,'manifest.json'),'utf8'));
  // Every Spotify golden stays pinned to Stage 6. Only these two visuals have new approval.
  const nonTarget=Object.fromEntries(Object.entries(recorded).filter(([key])=>key.startsWith('spotify-')));
  assert.deepEqual(nonTarget,Object.fromEntries(Object.entries(original).filter(([key])=>key.startsWith('spotify-') && (!process.env.UI_STAGE6_FOCUS || key.startsWith(process.env.UI_STAGE6_FOCUS+'-')))),'Spotify must remain pixel/frame identical');
  const visualRoot='tests/fixtures/voice-bubble-snapshots/'+device;
  const targets=Object.fromEntries(Object.entries(recorded).filter(([key])=>!key.startsWith('spotify-')));
  if(process.env.UI_STAGE6_RECORD==='1') {
    mkdirSync(visualRoot,{recursive:true});
    for(const key of Object.keys(targets)) cpSync(path.join(snapshotRoot,key+'.png'),path.join(visualRoot,key+'.png'));
    writeFileSync(path.join(visualRoot,'manifest.json'),JSON.stringify(targets,null,2)+'\n');
  } else {
    const all=JSON.parse(readFileSync(path.join(visualRoot,'manifest.json'),'utf8'));
    const expected=process.env.UI_STAGE6_FOCUS ? Object.fromEntries(Object.entries(all).filter(([key])=>key.startsWith(process.env.UI_STAGE6_FOCUS!+'-'))) : all;
    assert.deepEqual(targets,expected,'Voice/audio approved geometry/static pixels changed');
  }
 } finally {
  server.kill();
  spawnSync('xcrun',['simctl','uninstall',sim,bundle]);
  if(!process.env.UI_STAGE6_RENDER_CACHE)rmSync(dir,{recursive:true,force:true});
 }
});
