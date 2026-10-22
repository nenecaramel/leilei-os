import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
const root='ios/LeileiOS/LeileiOS/Chat/MessageSurface/';
test('voice bubbles use transcript/duration geometry and stable waveform presentation', {skip:process.platform!=='darwin'},()=>{
 assert.ok(existsSync(root+'NativeLiveVoiceBubbleGeometry.swift'),'Missing transcript/duration presentation geometry');
 const dir=mkdtempSync(path.join(os.tmpdir(),'voice-geometry-'));
 try {
  let source=readFileSync(root+'NativeLiveVoiceBubbleGeometry.swift','utf8');
  if(process.env.VOICE_VISUAL_MUTATION==='user-width')source=source.replace('return minimum + (maxContentWidth - minimum) * CGFloat(min(1, log1p(growth) / log1p(Double(240 - userShortestCharacterCount))))','return 68');
  if(process.env.VOICE_VISUAL_MUTATION==='audio-width')source=source.replace('return minimum + growth * CGFloat(min(1, log1p(seconds) / log1p(60 - audioShortestSeconds)))','return 280');
  if(process.env.VOICE_VISUAL_MUTATION==='waveform')source=source.replace('return (0..<count).map { _ in','return (0..<count).map { _ in').replace('return waveformMinimumHeight + CGFloat(state % span)','return 12');
  writeFileSync(path.join(dir,'Geometry.swift'),source);
  const build=spawnSync('xcrun',['swiftc','-parse-as-library','-module-cache-path',path.join(dir,'cache'),path.join(dir,'Geometry.swift'),'tests/fixtures/ios-voice-bubble-geometry.swift','-o',path.join(dir,'check')],{encoding:'utf8',timeout:180000});
  assert.equal(build.status,0,build.stderr);
  const a=spawnSync(path.join(dir,'check'),[],{encoding:'utf8'}),b=spawnSync(path.join(dir,'check'),[],{encoding:'utf8'});
  assert.equal(a.status,0,a.stderr);assert.equal(b.status,0,b.stderr);assert.equal(a.stdout,b.stdout,'separate processes must generate identical waveform');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('only the two bubble presentations change; playback/open/expansion remain exact main',()=>{
 const current=readFileSync(root+'NativeLiveAudioAttachmentBubble.swift','utf8');
 const original=readFileSync('tests/fixtures/audio-bubble-main-e538daaa.swift','utf8');
 assert.equal(createHash('sha256').update(original).digest('hex'),'32656bcaab981d3ac7445522c60cefe0cc58961665df6daf26113fa647844354','exact main bubble fixture');
 assert.equal(current.slice(current.indexOf('    private func playOrPause()'),current.indexOf('private struct NativeLiveAudioWaveform')).trimEnd()+'\n',original.slice(original.indexOf('    private func playOrPause()'),original.indexOf('private struct NativeLiveAudioWaveform')).trimEnd()+'\n');
 for(const marker of ['    private var failure:', '        .onDisappear']) {
  const end=marker.includes('failure')?'    var body:':'    private var';
  const section=(s:string)=>s.slice(s.indexOf(marker),s.indexOf(end,s.indexOf(marker)));
  assert.equal(section(current),section(original),marker);
 }
 assert.doesNotMatch(readFileSync(root+'NativeLiveVoiceBubbleGeometry.swift','utf8'),/Hasher|nativeLiveAttachmentBytes\(/);
});

test('assistant audio is one 45pt row with total-seconds label and no time text; user voice height matches',()=>{
 const audio=readFileSync(root+'NativeLiveAudioAttachmentBubble.swift','utf8');
 const geometry=readFileSync(root+'NativeLiveVoiceBubbleGeometry.swift','utf8');
 const user=readFileSync(root+'NativeLiveUserMessageRow.swift','utf8');
 assert.doesNotMatch(audio,/--:--|statusLabel|Text\("Audio"\)|\/ \\\(time|%d:%02d/);
 assert.match(audio,/private var effectiveDuration: TimeInterval\?[\s\S]*playback\.duration\.isFinite, playback\.duration > 0[\s\S]*return playback\.duration[\s\S]*return input\.durationSeconds/);
 assert.match(audio,/guard let duration = effectiveDuration else \{ return "—" \}/);
 assert.match(geometry,/u\{2033\}/);
 assert.match(geometry,/contentHeight: CGFloat = 21/);assert.match(geometry,/verticalInset: CGFloat = 12/);
 assert.match(audio,/\.padding\(\s*\.vertical,\s*chatTheme == \.iMessage\s*\? ChatPresentationLayout\.iMessageUserBubbleVerticalInset\s*: NativeLiveVoiceBubbleGeometry\.verticalInset\s*\)/);
 assert.match(user,/frame\(height: NativeLiveVoiceBubbleGeometry\.contentHeight/);
 assert.match(geometry,/waveformMinimumHeight: CGFloat = 4/);assert.match(geometry,/waveformMaximumHeight: CGFloat = 15/);
 assert.match(geometry,/waveformBarWidth: CGFloat = 2/);
 assert.match(geometry,/userLeadingInset: CGFloat = 8/);
 assert.match(geometry,/userTrailingInset: CGFloat = 14/);
 assert.match(geometry,/userClusterSpacing: CGFloat = 6/);
 assert.match(geometry,/audioMinimumWaveformWidth: CGFloat = 28/);
 assert.match(audio,/Button \{ playOrPause\(\) \}/);assert.match(audio,/Button \{ open\(\) \}/);
});


test('expanded user voice transcript inherits normal user text bubble layout',()=>{
 const user=readFileSync(root+'NativeLiveUserMessageRow.swift','utf8');
 assert.match(user,/private var usesCompactVoiceInsets: Bool[\s\S]*presentation\.isVoiceInput && !isVoiceTranscriptRevealed/);
 assert.match(user,/\.padding\(\.leading, usesCompactVoiceInsets \? NativeLiveVoiceBubbleGeometry\.userLeadingInset : ChatPresentationLayout\.bubbleHorizontalInset\)/);
 assert.match(user,/\.padding\(\.trailing, usesCompactVoiceInsets \? NativeLiveVoiceBubbleGeometry\.userTrailingInset : ChatPresentationLayout\.bubbleHorizontalInset\)/);
 assert.match(user,/NativeLiveVisualNodesView\(nodes:presentation\.textNodes,role:presentation\.role\)/);
});

test('voice/audio bubbles start growing after 2 characters / 2 seconds and reach the row width offered by each theme',()=>{
 const geometry=readFileSync(root+'NativeLiveVoiceBubbleGeometry.swift','utf8');
 const user=readFileSync(root+'NativeLiveUserMessageRow.swift','utf8');
 const audio=readFileSync(root+'NativeLiveAudioAttachmentBubble.swift','utf8');
 const eleven=readFileSync(root+'NativeLiveElevenLabsResultSurface.swift','utf8');
 assert.match(geometry,/userShortestCharacterCount = 2\b/);
 assert.match(geometry,/audioShortestSeconds: TimeInterval = 2\b/);
 assert.match(geometry,/static func userWidth\(transcript: String\?, clusterWidth: CGFloat = userFallbackClusterWidth,\s*maxContentWidth: CGFloat = userMaxContentWidth\)/);
 assert.match(geometry,/maximumWidth: CGFloat = audioMaximumWidth\) -> CGFloat/);
 // The offered width comes from the row: Original 48pt / iMessage 70pt clearance.
 const layout=readFileSync(root+'NativeLiveVoiceBubbleWidthLayout.swift','utf8');
 assert.match(layout,/struct NativeLiveVoiceBubbleWidthLayout: Layout/);
 assert.match(layout,/if let offered = proposal\.width, offered\.isFinite, offered > 0 \{ return width\(offered\) \}/);
 const iMessageVoice=user.slice(user.indexOf('private var iMessageVoiceBubble: some View'),user.indexOf('private var usesCompactVoiceInsets: Bool'));
 assert.match(iMessageVoice,/\.nativeLiveVoiceBubbleWidth\(alignment: \.trailing/);
 assert.match(iMessageVoice,/NativeLiveVoiceBubbleGeometry\.userWidth\(transcript: presentation\.copyText/);
 const originalVoice=user.slice(user.indexOf('private struct NativeLiveVoiceMessageBubbleVisual'));
 assert.match(originalVoice,/\.nativeLiveVoiceBubbleWidth\(alignment: \.trailing/);
 assert.doesNotMatch(originalVoice,/\.frame\(width: NativeLiveVoiceBubbleGeometry\.userWidth/);
 for(const surface of [audio,eleven]) {
  assert.match(surface,/\.nativeLiveVoiceBubbleWidth\(alignment: \.leading/);
  assert.match(surface,/NativeLiveVoiceBubbleGeometry\.audioWidth\([\s\S]*maximumWidth: maximum\)/);
  assert.doesNotMatch(surface,/\.frame\(width: bubbleWidth/);
 }
});
