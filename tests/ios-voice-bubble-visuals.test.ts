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

// Sizes, insets and caps are owner-tuned on device; the numeric geometry is
// exercised by the Swift fixture above. These tests cover content and wiring.
test('assistant audio shows total seconds and no time text; play and open are separate actions',()=>{
 const audio=readFileSync(root+'NativeLiveAudioAttachmentBubble.swift','utf8');
 const geometry=readFileSync(root+'NativeLiveVoiceBubbleGeometry.swift','utf8');
 assert.doesNotMatch(audio,/--:--|statusLabel|Text\("Audio"\)|\/ \\\(time|%d:%02d/);
 assert.match(audio,/private var effectiveDuration: TimeInterval\?[\s\S]*playback\.duration\.isFinite, playback\.duration > 0[\s\S]*return playback\.duration[\s\S]*return input\.durationSeconds/);
 assert.match(audio,/guard let duration = effectiveDuration else \{ return "—" \}/);
 assert.match(geometry,/u\{2033\}/);
 assert.match(audio,/Button \{ playOrPause\(\) \}/);assert.match(audio,/Button \{ open\(\) \}/);
});

test('expanded user voice transcript reuses the normal text renderer',()=>{
 const user=readFileSync(root+'NativeLiveUserMessageRow.swift','utf8');
 assert.match(user,/private var usesCompactVoiceInsets: Bool[\s\S]*presentation\.isVoiceInput && !isVoiceTranscriptRevealed/);
 assert.match(user,/NativeLiveVisualNodesView\(nodes:presentation\.textNodes,role:presentation\.role\)/);
});

test('voice and audio bubbles size from the transcript or duration and the width their row offers',()=>{
 const user=readFileSync(root+'NativeLiveUserMessageRow.swift','utf8');
 const audio=readFileSync(root+'NativeLiveAudioAttachmentBubble.swift','utf8');
 const eleven=readFileSync(root+'NativeLiveElevenLabsResultSurface.swift','utf8');
 const layout=readFileSync(root+'NativeLiveVoiceBubbleWidthLayout.swift','utf8');
 assert.match(layout,/struct NativeLiveVoiceBubbleWidthLayout: Layout/);
 assert.match(layout,/if let offered = proposal\.width, offered\.isFinite, offered > 0 \{ return width\(offered\) \}/);
 const iMessageVoice=user.slice(user.indexOf('private var iMessageVoiceBubble: some View'),user.indexOf('private var usesCompactVoiceInsets: Bool'));
 const originalVoice=user.slice(user.indexOf('@ViewBuilder private var textBubble: some View'),user.indexOf('private func toggleVoice()'));
 for(const voice of [iMessageVoice,originalVoice]) {
  assert.match(voice,/\.nativeLiveVoiceBubbleWidth\(/);
  assert.match(voice,/NativeLiveVoiceBubbleGeometry\.userWidth\(transcript: presentation\.copyText/);
  // Expanding keeps the collapsed width: the width wraps glyphs and transcript.
  assert.ok(voice.indexOf('.nativeLiveVoiceBubbleWidth(') > voice.indexOf('if isVoiceTranscriptRevealed {'));
 }
 for(const surface of [audio,eleven]) {
  assert.match(surface,/\.nativeLiveVoiceBubbleWidth\(/);
  assert.match(surface,/NativeLiveVoiceBubbleGeometry\.audioWidth\([\s\S]*maximumWidth: maximum\)/);
 }
});
