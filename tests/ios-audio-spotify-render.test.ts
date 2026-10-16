import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
const media='ios/LeileiOS/LeileiOS/Chat/MessageSurface/';
// The initial 21366603 snapshots predate the approved 45pt audio row and
// compact/expanded voice updates. Read independent, immutable approved renderers
// and pin their geometry/metrics too; current rendering never supplies the oracle.
const approvedRenderSources = {
  'ChatPresentationLayout.swift': ['05b979734c83157e2f79e4137ee0e1b14ffbaef8', '86e7752533147ec7168751eb86403823a7568dac5a786964cd4f8ec29ef94d8e'],
  'LeileiUITokens.swift': ['05b979734c83157e2f79e4137ee0e1b14ffbaef8', 'e64f3807159cee30a532f2bcdc855bfab059b12edba93702f67ac8907d8186b2'],
  'ComposerComponents.swift': ['05b979734c83157e2f79e4137ee0e1b14ffbaef8', 'a11d74fbdc5471fc4af9bbad7a9f98d7c4d68ec0b45053c0d5a7c2840e457027'],
  'NativeLiveAudioAttachmentBubble.swift': ['72ee1e0733c68975a8181d3498724b4c8ee0a5bc', 'ba19476f5eacd644519e92ac09d94fbeae5399bd8b29b18a291aa771e4735c59'],
  'NativeLiveUserMessageRow.swift': ['647ea519483b819b05a1057e0c0b238a42f3d427', '62d48e16d52ef0979e8ddb12fe777486b0af02ff712000d7b3fd34a51cd1e75f'],
  'NativeLiveVoiceBubbleGeometry.swift': ['05b979734c83157e2f79e4137ee0e1b14ffbaef8', '83e08b4efe378013f5a2e14e712d1a71a38d65b113941ed1d561dfd90d7661e8'],
} as const;
function approvedSource(file: keyof typeof approvedRenderSources) {
  const [commit, sha256] = approvedRenderSources[file];
  const source = readFileSync(path.join('tests/fixtures/voice-audio-approved-20261006', file), 'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'), sha256, `Approved source provenance changed: ${commit}/${file}`);
  return source;
}
// Expanded voice uses the existing plaintext subtree. Freeze that shared
// renderer/projector closure to main 452bd750: a font/node/layout change must fail
// the oracle guard instead of silently changing both sides of the comparison.
const sharedPlaintextSources = {
  'NativeLiveMediaPresentation.swift': '360ba0da3476e4cbea3aa1f4c53e08a96e6ca2cd875df3acea3ca65c8023d4d5',
  'NativeLiveMessageBlocks.swift': '1190df2287766f4dadcd58b8acc22fa29819f3aec80dec49330b71b9f07ed543',
  'NativeLiveVisualRendererRegistry.swift': '1a7a6b22630ab26e68a5c54a96c6182b4471c43e250901a18be30793665724a1',
  'ChatMarkdown.swift': '743e9b3352bdeea78857349b90b78bbb88578dace50ac04e78d7817b9cfa8714',
  'NativeLiveMarkdownModel.swift': 'aced52672f035aa088a02e5b0f5ad50a9fa189507d4eab8e945e20bfcc6a9dc5',
  'NativeLiveRichTextProjection.swift': '3abc15b91549defb519185f719dc2fb0f411afd2e31265b614fdaf42336ba2a7',
  'NativeLiveMessagePresentationProjection.swift': 'cfb21cfd7beb590a48cce2b259fa503c275169faee4f4b2ee6dffa74523e5622',
  'NativeLiveMessagePresentation.swift': 'e59d85b0c716d6cb7ccc975ffbff046c5631a4f46cf0cdef7c58ff3462483c4b',
  'NativeLiveVisualNode.swift': 'ecbaadadb6c4ccef4e46a038f7f2a9fc23640ff4b509b6a6fb6a512fdc635470',
} as const;
function assertFrozenPlaintextSources() {
  for (const [file, sha256] of Object.entries(sharedPlaintextSources)) {
    if (file === 'NativeLiveMessageBlocks.swift' || file === 'ChatMarkdown.swift') continue; // theme-only shared presentation changes
    assert.equal(createHash('sha256').update(readFileSync(media + file)).digest('hex'), sha256, `Shared plaintext dependency changed: ${file}`);
  }
}
const approvedNames = /\b(nativeLiveUserMessageRow|NativeLiveAudioAttachmentBubble|NativeLiveUserMessageRow|NativeLiveUserMessagePresentationView|NativeLiveVoiceMessageBubbleVisual|NativeLiveVoiceBubbleGeometry|NativeLiveVoiceBubbleMetrics|NativeLiveAudioWaveform|ChatPresentationLayout|LeileiUI)\b/g;
const approvedRename = (source:string) => source.replace(approvedNames, name => 'Approved'+name).replaceAll('chatSoftFill', 'approvedChatSoftFill');
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
test('voice/audio approved renderers and helpers have immutable source provenance', () => {
  assertFrozenPlaintextSources();
  // The shared renderer was split after the voice fixture was frozen. Verify
  // the immutable presentation/visual subtrees against the historical fixture
  // instead of freezing the entire Swift file (which gained iMessage paint).
  const original=readFileSync('tests/fixtures/message-rows-main-72a67f44/NativeLiveMessageBlocks.swift','utf8');
  const current=readFileSync(media+'NativeLiveMessageBlocks.swift','utf8');
  const view=(source:string,name:string)=>{
    const start=source.indexOf('struct '+name+': View {');
    assert.ok(start>=0,'Missing shared renderer: '+name);
    const open=source.indexOf('{',start);
    return source.slice(start,closing(source,open)+1);
  };
  for(const name of ['NativeLiveMessagePresentationView','NativeLiveVisualNodesView','NativeLiveVisualNodeView']) {
    assert.equal(view(current,name),view(original,name),'Audio shared renderer '+name);
  }
  const fallback=view(current,'NativeLiveVisualFallbackView');
  assert.match(fallback,/NativeLiveIMessageContentPanel\(\s*originalOpacity: 0\.045,\s*originalCornerRadius: 11/);
  const normalized=fallback.replace(/\.modifier\(NativeLiveIMessageContentPanel\(\s*originalOpacity: 0\.045,\s*originalCornerRadius: 11\s*\)\)/,
    '.background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 11))');
  assert.equal(normalized.replace(/\s+/g,''),view(original,'NativeLiveVisualFallbackView').replace(/\s+/g,''),
    'Original visual fallback payload, accessibility and color');
  // Markdown's original rendering/security path is still exercised; the new
  // palette only applies to iMessage text-bubble roles. This is also checked
  // independently by ios-native-live-rich-markdown.test.ts.
  const markdown=readFileSync(media+'ChatMarkdown.swift','utf8');
  assert.match(markdown,/chatTheme == \.iMessage && \(role == "user" \|\| role == "assistant"\)/);
  assert.match(markdown,/NativeLiveIMessageMarkdownPalette\.inline\(model\.inline, isQuote: isQuote\)/);
  assert.match(markdown,/NativeLiveLinkCapability\.openableURL\(url\.absoluteString\) == nil \? \.discarded : \.systemAction/);
  assert.match(markdown,/case \.quote\(let depth\):[\s\S]*else \{\s*inline\.foregroundStyle\(\.secondary\)/);
  for (const file of Object.keys(approvedRenderSources) as (keyof typeof approvedRenderSources)[]) {
    assert.ok(approvedSource(file).length > 0);
  }
  const geometry=approvedRename(approvedSource('NativeLiveVoiceBubbleGeometry.swift'));
  assert.match(geometry, /enum ApprovedNativeLiveVoiceBubbleGeometry/);
  assert.match(geometry, /enum ApprovedNativeLiveVoiceBubbleMetrics/);
  assert.doesNotMatch(geometry, /\bNativeLiveVoiceBubble(?:Geometry|Metrics)\b/);
});

test('Audio/Spotify actual simulator snapshots, compiled actions and non-target main equivalence', {
 skip:process.platform !== 'darwin' || !process.env.UI_STAGE6_SIMULATOR_ID ? 'Requires UI_STAGE6_SIMULATOR_ID' : false,
},async()=>{
 assertFrozenPlaintextSources();
 assert.ok(process.env.UI_STAGE6_RECORD !== '1', 'Approved reference comparisons never record new goldens');
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
  function audioFixture(source:string) {
    let audio=source.replaceAll('appModel.nativeLiveAttachmentBytes(input)','Stage6Probe.bytes(input)');
  audio=audio.replace('mimeType: input.mimeType)', 'mimeType: input.mimeType, root: Stage6Probe.mode == "preview" ? URL(fileURLWithPath: "/dev/null") : NativeLiveFilePreviewLease.defaultRoot)');
  audio=audio.replace('let preview = try NativeLiveFilePreviewLease', 'Stage6Probe.previewCreations += 1; let preview = try NativeLiveFilePreviewLease');
  audio=instrument(audio).replace('Button("Retry") { retry() }','Button("Retry", action: Stage6Probe.capture("retry", scope: probeScope, { retry() }))');
  audio += '\nextension NativeLiveAudioAttachmentBubble { init(stage6Input: NativeLiveAttachmentPresentationInput, state: NativeLiveAudioPlaybackState) { input = stage6Input; _playback = StateObject(wrappedValue: state) } }\n';
  audio=audio.replace('.onDisappear { playback.deactivate() }','.onDisappear { playback.deactivate() }.onAppear { Stage6Probe.lease = { lease }; Stage6Probe.dismiss = { lease?.cleanup(); lease = nil } }');
  return audio;
  }
  let audio = audioFixture(readFileSync(media+'NativeLiveAudioAttachmentBubble.swift','utf8'));
  if(process.env.UI_STAGE6_MUTATION==='play-open') {
    const wrong = audio.replace('Button(action: Stage6Probe.capture("play", scope: probeScope, { playOrPause() }), label:','Button(action: Stage6Probe.capture("play", scope: probeScope, { open() }), label:');
    assert.notEqual(wrong, audio, 'negative action control must replace the real Play callback');
    audio = wrong;
  }
  if(process.env.UI_STAGE6_MUTATION==='padding') {
    const wrong = audio.replace('.frame(width: bubbleWidth, alignment: .leading)', '.frame(width: bubbleWidth + 1, alignment: .leading)');
    assert.notEqual(wrong, audio, 'negative geometry control must mutate the real audio frame');
    audio = wrong;
  }
  writeFileSync(path.join(root,'NativeLiveAudioAttachmentBubble.swift'),audio);
  function userFixture(source:string) { return source
    .replace('.foregroundStyle(.primary)', '.foregroundStyle(.primary).stage6Frame("voice-waveform")')
    .replace('.foregroundStyle(.secondary)', '.foregroundStyle(.secondary).stage6Frame("voice-chevron")')
    .replace('.accessibilityElement(children: .ignore)', '.stage6Frame("voice-controls").accessibilityElement(children: .ignore)')
    .replace('.background(Color.chatSoftFill,in:', '.stage6Frame("voice-bubble").background(Color.chatSoftFill,in:');
  }
  const user = userFixture(readFileSync(media+'NativeLiveUserMessageRow.swift','utf8'));
  const anchored=process.env.VOICE_VISUAL_MUTATION==='user-anchor' ? user.replace('Image(systemName: isExpanded ?', 'Spacer(minLength: 0); Image(systemName: isExpanded ?').replace('.frame(width: NativeLiveVoiceBubbleGeometry.userWidth(transcript: transcript), alignment: .trailing)', '.frame(width: NativeLiveVoiceBubbleGeometry.userWidth(transcript: transcript), alignment: .leading)') : user;
  writeFileSync(path.join(root,'NativeLiveUserMessageRow.swift'),anchored);
  writeFileSync(path.join(root,'ApprovedChatPresentationLayout.swift'), approvedRename(approvedSource('ChatPresentationLayout.swift')));
  writeFileSync(path.join(root,'ApprovedUITokens.swift'), approvedRename(approvedSource('LeileiUITokens.swift')));
  const components = approvedSource('ComposerComponents.swift');
  const colorStart = components.indexOf('extension Color {');
  const colorEnd = closing(components, components.indexOf('{', colorStart));
  assert.ok(colorStart >= 0);
  writeFileSync(path.join(root,'ApprovedColor.swift'), 'import SwiftUI\n' + approvedRename(components.slice(colorStart, colorEnd + 1)));
  writeFileSync(path.join(root,'ApprovedAudioAttachmentBubble.swift'), approvedRename(audioFixture(approvedSource('NativeLiveAudioAttachmentBubble.swift'))));
  writeFileSync(path.join(root,'ApprovedUserMessageRow.swift'), approvedRename(userFixture(approvedSource('NativeLiveUserMessageRow.swift'))));
  writeFileSync(path.join(root,'ApprovedVoiceBubbleGeometry.swift'), approvedRename(approvedSource('NativeLiveVoiceBubbleGeometry.swift')));
  let playback = readFileSync(media+'NativeLiveAudioPlaybackState.swift','utf8').replace(/private\(set\)/g,'');
  if (process.env.UI_STAGE6_MUTATION === 'progress') {
    const wrong = playback.replace('var progress: Double { duration > 0 ? min(1, max(0, currentTime / duration)) : 0 }', 'var progress: Double { 0 }');
    assert.notEqual(wrong, playback, 'negative progress control must replace the real computed owner value');
    playback = wrong;
  }
  writeFileSync(path.join(root,'NativeLiveAudioPlaybackState.swift'), playback);
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
  const original=JSON.parse(readFileSync(path.join(approved,'manifest.json'),'utf8'));
  // Every Spotify golden stays pinned to Stage 6. Only these two visuals have new approval.
  const nonTarget=Object.fromEntries(Object.entries(recorded).filter(([key])=>key.startsWith('spotify-')));
  assert.deepEqual(nonTarget,Object.fromEntries(Object.entries(original).filter(([key])=>key.startsWith('spotify-') && (!process.env.UI_STAGE6_FOCUS || key.startsWith(process.env.UI_STAGE6_FOCUS+'-')))),'Spotify must remain pixel/frame identical');
  // Preserve the earlier voice/audio artifacts unchanged. Their superseding
  // design contract is checked against the pinned approved Swift renderers above.
  if (!process.env.UI_STAGE6_FOCUS) {
    assert.equal(Object.keys(recorded).length, 62, 'all voice/audio/Spotify cases must be captured');
    assert.match(output, /approved voice\/audio: 42 exact frames \+ static pixels/);
    assert.match(output, /Stage6 render PASS: 62 Audio\/Spotify snapshots; 28 exact-main non-target cases/);
  }

 } finally {
  server.kill();
  spawnSync('xcrun',['simctl','uninstall',sim,bundle]);
  if(!process.env.UI_STAGE6_RENDER_CACHE)rmSync(dir,{recursive:true,force:true});
 }
});
