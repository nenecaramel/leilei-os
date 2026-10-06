import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
const root = 'ios/LeileiOS/LeileiOS/';
const media = root + 'Chat/MessageSurface/';
function check(fixture: string, files: string[], marker: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'stage6-check-'));
  try {
    files = files.map(file => {
      let source = readFileSync(file,'utf8'), changed = source;
      const mutation = process.env.STAGE6_MUTATION;
      if (mutation === 'pdf-audio' && file.endsWith('NativeLiveMediaPresentation.swift')) changed = source.replace('        return .file', '        if mime == "application/pdf" { return .audio }\n        return .file');
      if (mutation === 'loose-identity' && file.endsWith('NativeLiveSpotifyPresentation.swift')) changed = source.replace('allowedProviderTools.contains(providerToolName)', 'providerToolName.lowercased().contains("spotify")');
      if (mutation === 'loose-schema' && file.endsWith('NativeLiveSpotifyPresentation.swift')) changed = source.replace('allowedProviderTools.contains(providerToolName), ', '');
      if (changed === source) return file;
      const mutated = path.join(dir,path.basename(file)); writeFileSync(mutated,changed); return mutated;
    });
    const compile = spawnSync('xcrun', ['swiftc', '-parse-as-library', '-module-cache-path', path.join(dir,'cache'), ...files, fixture, '-o', path.join(dir,'check')], {encoding:'utf8', timeout:180000});
    assert.equal(compile.status,0,compile.stderr);
    const result = spawnSync(path.join(dir,'check'),[],{encoding:'utf8',timeout:60000});
    assert.equal(result.status,0,result.stderr); assert.match(result.stdout,new RegExp(marker));
  } finally { rmSync(dir,{recursive:true,force:true}); }
}
const models = [root+'Infrastructure/NativeLiveRuntimeModels.swift', root+'Infrastructure/API/NativeLive/NativeLiveModels.swift', root+'Infrastructure/API/NativeLive/NativeLiveInputMode.swift'];
const presentationFiles = ['NativeLiveMarkdownModel','NativeLiveRichTextProjection','NativeLiveVisualNode','NativeLiveVisualRendererRegistry','NativeLiveVisualSandboxModel','NativeLiveSVGModel','NativeLiveStructuredToolResult','NativeLiveCitationPresentation','NativeLiveStructuredJSON','NativeLiveMessagePresentation','NativeLiveMessagePresentationProjection','NativeLiveMediaPresentation','NativeLiveAttachmentCache'].map(n=>media+n+'.swift');
test('actual Swift classification rejects PDF and malformed MIME while routing audio MIME/UTType extensions', {skip:process.platform !== 'darwin'}, () => {
  check('tests/fixtures/ios-audio-classification.swift',[...models,...presentationFiles],'Audio classification PASS');
});
test('actual Swift Spotify projector requires canonical identity and valid schema, preserves URLs and provider errors', {skip:process.platform !== 'darwin'}, async () => {
  const fixture=JSON.parse(readFileSync('tests/fixtures/spotify-sdk-output.json','utf8'));
  const { normalizeClaudeEvents } = await import('../tools/claude-bridge/src/normalized-events.mjs');
  const events=normalizeClaudeEvents(fixture.raw,{logicalConversationId:'fixture',mode:'new',parentProviderSessionId:null});
  assert.deepEqual({providerToolName:events.find((event:any)=>event.type==='tool_use').payload.tool_name,output:events.find((event:any)=>event.type==='tool_result').payload.output},fixture.expected);
  assert.ok(existsSync(media+'NativeLiveSpotifyPresentation.swift'),'Spotify presentation projector is required');
  check('tests/fixtures/ios-spotify-presentation.swift',[...models,media+'NativeLiveSpotifyPresentation.swift'],'Spotify projector PASS');
});
test('real AVAudioPlayer progress, single-flight load, pause/resume/replay and disposal', {skip:process.platform !== 'darwin'}, () => {
  assert.ok(existsSync(media+'NativeLiveAudioPlaybackState.swift'),'Audio playback state is required');
  check('tests/fixtures/ios-audio-playback.swift',[...models,...presentationFiles,media+'NativeLiveAudioPlaybackState.swift'],'Audio playback PASS');
});
test('presentation seams preserve ordinary cards, tool permission order, projection and attachment authority byte-for-byte', () => {
  for (const file of ['NativeLiveAudioAttachmentBubble.swift','NativeLiveSpotifyCard.swift']) assert.ok(existsSync(media+file),file+' is required');
  const baselineRoot='tests/fixtures/media-tools-main-f98414a9/';
  const manifest=JSON.parse(readFileSync(baselineRoot+'blobs.json','utf8'));
  const baseline=(file:string)=>readFileSync(baselineRoot+path.basename(file),'utf8');
  const blob=(file:string)=>{const bytes=readFileSync(file);return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');};
  for(const name of ['NativeLiveMediaRenderer.swift','NativeLiveSVGRenderer.swift','NativeLiveToolActivity.swift']) assert.equal(blob(baselineRoot+name),manifest.files[media+name]);
  const renderer=readFileSync(media+'NativeLiveMediaRenderer.swift','utf8');
  const previous=baseline(media+'NativeLiveMediaRenderer.swift');
  assert.equal(renderer.replace(/    @ViewBuilder var body: some View \{\n        if input.mediaKind == \.audio \{ NativeLiveAudioAttachmentBubble\(input: input\) \}\n        else \{ ordinaryBody \}\n    \}\n\n    private var ordinaryBody: some View \{/, '    var body: some View {'),previous);
  const tool=readFileSync(media+'NativeLiveToolActivity.swift','utf8');
  assert.equal(tool.replace(/            if tool.state != \.running,[\s\S]*?            \} else \{\n/, '').replace(/\n            \}\n\n            ForEach/, '\n\n            ForEach'),baseline(media+'NativeLiveToolActivity.swift'));
  for (const file of ['NativeLiveTurnActivityProjection.swift','NativeLiveTurnActivityProjection+Tools.swift','NativeLiveInteractions.swift','NativeLiveStructuredToolResult.swift']) assert.equal(blob(media+file),manifest.files[media+file],file);
  const coordination=root+'App/NativeLiveAttachmentCoordination.swift';
  assert.equal(blob(coordination),manifest.files[coordination]);
});
