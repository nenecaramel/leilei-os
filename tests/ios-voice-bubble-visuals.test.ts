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
  if(process.env.VOICE_VISUAL_MUTATION==='user-width')source=source.replace('return 68 + 57 * min(1, log1p(Double(count)) / log1p(240))','return 68');
  if(process.env.VOICE_VISUAL_MUTATION==='audio-width')source=source.replace('return 150 + 100 * min(1, log1p(seconds) / log1p(120))','return 280');
  if(process.env.VOICE_VISUAL_MUTATION==='waveform')source=source.replace('return (0..<count).map { _ in','return (0..<count).map { _ in').replace('return 6 + CGFloat(state % 17)','return 12');
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
