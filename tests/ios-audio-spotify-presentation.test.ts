import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertInteractionThemePreservesOriginal } from './ios-theme-interaction-assertions.js';
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
  // Owner-approved 10/29: one image takes one grid tile (the grid reports only
  // that width), and an assistant image is held to the user's tile width.
  const tileWidth="// An assistant image outside a grid takes the user's grid tile width; its height\n// stays the card's own, so failure and retry rows still fit below the image.\nstruct NativeLiveMediaTileWidth: Layout {\n    let leadingClearance: Double\n    func sizeThatFits(proposal:ProposedViewSize,subviews:Subviews,cache:inout ()) -> CGSize {\n        let width = NativeLiveMediaLayout(count:1,availableWidth:proposal.width ?? 320,leadingClearance:leadingClearance).tileWidth\n        let height = subviews.map { $0.sizeThatFits(.init(width:width,height:nil)).height }.max() ?? 0\n        return .init(width:width,height:height)\n    }\n    func placeSubviews(in bounds:CGRect,proposal:ProposedViewSize,subviews:Subviews,cache:inout ()) {\n        for view in subviews {\n            view.place(at:.init(x:bounds.minX,y:bounds.minY),anchor:.topLeading,proposal:.init(width:bounds.width,height:nil))\n        }\n    }\n}\n\n// The tile matches the user's grid in the same theme: same row, same clearance.\nstruct NativeLiveAssistantImageTile: View {\n    @Environment(\\.chatTheme) private var chatTheme\n    let input: NativeLiveAttachmentPresentationInput\n    var body: some View {\n        NativeLiveMediaTileWidth(leadingClearance:chatTheme == .iMessage\n            ? ChatPresentationLayout.iMessageUserLeadingClearance : ChatPresentationLayout.userLeadingClearance) {\n            NativeLiveMediaCard(input:input)\n        }\n    }\n}\n\n";
  const singleTile=readFileSync(media+'NativeLiveMediaRenderer.swift','utf8');
  assert.ok(singleTile.includes(tileWidth) && singleTile.includes('return .init(width:policy.occupiedWidth,height:')
    && singleTile.includes('NativeLiveMediaLayout(count:count,placedWidth:bounds.width)'));
  const renderer=singleTile.replace(tileWidth,'').replace('return .init(width:policy.occupiedWidth,height:','return .init(width:width,height:')
    .replace('NativeLiveMediaLayout(count:count,placedWidth:bounds.width)','NativeLiveMediaLayout(count:count,availableWidth:bounds.width)');
  const previous=baseline(media+'NativeLiveMediaRenderer.swift');
  const legacyRender=renderer.replace(/    @ViewBuilder var body: some View \{\n        if input.mediaKind == \.audio \{ NativeLiveAudioAttachmentBubble\(input: input\) \}\n        else \{ ordinaryBody \}\n    \}\n\n    private var ordinaryBody: some View \{/, '    var body: some View {');
  const currentPaintStart=legacyRender.indexOf('    // Ordinary files reuse rich-content glass;');
  const originalPaintStart=previous.indexOf('    private var fileLabel: some View {');
  const currentPaintEnd=legacyRender.indexOf('    private func retryFailedOperation()');
  const originalPaintEnd=previous.indexOf('    private func retryFailedOperation()');
  assert.ok(currentPaintStart>0 && originalPaintStart>0 && currentPaintEnd>currentPaintStart && originalPaintEnd>originalPaintStart);
  assert.match(renderer.slice(currentPaintStart,currentPaintEnd), /if input\.mediaKind == \.file \{/);
  assert.match(renderer.slice(currentPaintStart,currentPaintEnd), /NativeLiveIMessageContentPanel\(\s*originalOpacity: 0\.045,\s*originalCornerRadius: 12/);
  assert.match(renderer.slice(currentPaintStart,currentPaintEnd), /Color\.primary\.opacity\(0\.045\)/);
  const withoutAcceptedFileLabel=legacyRender.slice(0,currentPaintStart)+previous.slice(originalPaintStart,originalPaintEnd)+legacyRender.slice(currentPaintEnd);
  assert.equal(withoutAcceptedFileLabel,previous,
    'Media loader, gallery, playback routing, retries and non-file renderers remain immutable');
  const tool=readFileSync(media+'NativeLiveToolActivity.swift','utf8');
  const toolBaseline=baseline(media+'NativeLiveToolActivity.swift');
  const stableToolActivity=(source:string)=>source.slice(source.indexOf('struct NativeLiveToolActivityRow: View'),source.indexOf('enum NativeLiveToolCallState: Equatable'));
  assert.equal(stableToolActivity(tool),stableToolActivity(toolBaseline),
    'Tool permission order, provider result routing and async callback target are unchanged');
  assert.match(tool,/\.modifier\(NativeLiveToolWallpaperGlass\(enabled: iMessageWallpaperVisible\)\)/);
  assert.match(tool,/if enabled \{\s*content\.glassEffect\(/);
  assert.match(tool,/else \{\s*content\s*\}/);
  for(const label of ['Running','Done','Failed','No result']) assert.ok(tool.includes('"'+label+'"'),'Status label: '+label);
  assert.match(tool,/\.sheet\(isPresented: \$isShowingDetails\)/);
  for (const file of ['NativeLiveTurnActivityProjection.swift','NativeLiveTurnActivityProjection+Tools.swift','NativeLiveStructuredToolResult.swift']) assert.equal(blob(media+file),manifest.files[media+file],file);
  const originalInteractions=readFileSync('tests/fixtures/runtime-activity-main-8efd5977/NativeLiveInteractions.swift','utf8');
  assert.equal(blob('tests/fixtures/runtime-activity-main-8efd5977/NativeLiveInteractions.swift'),
    manifest.files[media+'NativeLiveInteractions.swift'], 'Historical interaction oracle');
  assertInteractionThemePreservesOriginal(readFileSync(media+'NativeLiveInteractions.swift','utf8'),originalInteractions);
  const coordination=root+'App/NativeLiveAttachmentCoordination.swift';
  assert.equal(blob(coordination),manifest.files[coordination]);
});
