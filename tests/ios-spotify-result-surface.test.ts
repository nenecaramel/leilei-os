import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withoutSwiftPaint } from './helpers/swift-paint.js';
import { assertInteractionThemePreservesOriginal } from './ios-theme-interaction-assertions.js';
const root = 'ios/LeileiOS/LeileiOS/';
const surface = root + 'Chat/MessageSurface/';

test('ToolActivity is provider-neutral and AssistantTurn owns results between Activity and body', () => {
  let tool = readFileSync(surface+'NativeLiveToolActivity.swift','utf8');
  if(process.env.SPOTIFY_SURFACE_MUTATION==='activity') {
    tool=tool.replace('            NativeLiveToolCallCard(', '            if tool.state != .running, let spotify = NativeLiveSpotifyProjector.project(providerToolName: tool.providerToolName, output: tool.output) {\n                NativeLiveSpotifyCard(presentation: spotify, tool: tool)\n            } else {\n            NativeLiveToolCallCard(').replace('\n            ForEach(permissionInteractions)', '\n            }\n            ForEach(permissionInteractions)');
  }
  assert.doesNotMatch(tool, /NativeLiveSpotify/);
  assert.match(tool, /NativeLiveToolCallCard\(/);
  assert.match(tool, /ForEach\(permissionInteractions\)/);
  const assistant = readFileSync(surface+'NativeLiveAssistantTurnRow.swift','utf8');
  assert.match(assistant, /NativeLiveVisibleThinkingSurface\(items: turn\.visibleThinking, murmurText: turn\.murmurText\)(?:\s*\.padding\([^\n]*\))?\s+activityArea(?:\s*\.padding\([^\n]*\))?\s+spotifyResultArea\s+elevenLabsResultArea\s+if chatTheme == \.iMessage \{\s*NativeLiveIMessageTextBubbleList\(/);
  assert.match(assistant, /else \{\s*NativeLiveMessagePresentationView\(presentation:turn\.bodyPresentation\)/);
  assert.match(assistant, /NativeLiveSpotifyResultSurface\(items: items\)/);
  const view = readFileSync(surface+'NativeLiveSpotifyResultSurface.swift','utf8');
  assert.doesNotMatch(view, /isActivityExpanded|Permission|Interaction|runtimeSurface|blocks/);
  assert.match(view, /NativeLiveSpotifyCard\(presentation: item.presentation, tool: item.tool\)/);
});

test('real Swift standalone items consume existing live/durable tool truth in provider order', { skip: process.platform !== 'darwin' }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(),'spotify-surface-projection-'));
  try {
    const tool = readFileSync(surface+'NativeLiveToolActivity.swift','utf8');
    writeFileSync(path.join(dir,'State.swift'), tool.slice(tool.indexOf('enum NativeLiveToolCallState:'),tool.indexOf('struct NativeLiveToolCallCard:')));
    const reconcile=readFileSync(surface+'NativeLiveAssistantTurnPresentation.swift','utf8');
    writeFileSync(path.join(dir,'Reconcile.swift'), 'import Foundation\n'+reconcile.slice(reconcile.indexOf('extension NativeLiveTurnActivityProjection {')));
    const files = [root+'Infrastructure/NativeLiveRuntimeModels.swift', root+'Infrastructure/API/NativeLive/NativeLiveModels.swift', root+'Infrastructure/API/NativeLive/NativeLiveInputMode.swift', ...readdirSync(surface).filter(f=>f.startsWith('NativeLiveTurnActivityProjection') && f.endsWith('.swift')).map(f=>surface+f), surface+'NativeLiveSpotifyPresentation.swift', surface+'NativeLiveSpotifyResultSurfaceProjection.swift',path.join(dir,'State.swift'),path.join(dir,'Reconcile.swift')];
    if(process.env.SPOTIFY_SURFACE_MUTATION === 'fuzzy') {
      const file = surface+'NativeLiveSpotifyPresentation.swift';
      const copy=path.join(dir,'Spotify.swift');
      writeFileSync(copy,readFileSync(file,'utf8').replace('allowedProviderTools.contains(providerToolName)','providerToolName.contains("Spotify")'));
      files[files.indexOf(file)]=copy;
    }
    if(process.env.SPOTIFY_SURFACE_MUTATION === 'last') {
      const file = surface+'NativeLiveSpotifyResultSurfaceProjection.swift';
      const copy=path.join(dir,'Surface.swift');
      writeFileSync(copy,readFileSync(file,'utf8').replace('tools.sorted', 'Array(tools.suffix(1)).sorted'));
      files[files.indexOf(file)]=copy;
    }
    const compile=spawnSync('xcrun',['swiftc','-parse-as-library','-module-cache-path',path.join(dir,'cache'),...files,'tests/fixtures/ios-spotify-result-surface.swift','-o',path.join(dir,'check')],{encoding:'utf8',timeout:180000});
    assert.equal(compile.status,0,compile.stderr);
    const run=spawnSync(path.join(dir,'check'),[],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    assert.match(run.stdout,/Spotify surface PASS/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('Spotify baseline stays byte-identical except explicitly accepted assistant presentation additions', () => {
  // Frozen hashes also work in CI's shallow checkout; never require old Git objects.
  const manifest=JSON.parse(readFileSync('tests/fixtures/spotify-surface-main-41bf880f.json','utf8'));
  assert.equal(manifest.ref,'41bf880f24a5d42dd48fb39603c47080b3ec75bd');
  for (const [file,sha] of Object.entries(manifest.sha256)) {
    const content=readFileSync(file,'utf8');
    if (file.endsWith('/NativeLiveInteractions.swift')) {
      // The historical Spotify interaction fixture remains immutable. Only
      // the accepted iMessage glass modifier is allowed around its two cards.
      const original=readFileSync('tests/fixtures/runtime-activity-main-8efd5977/NativeLiveInteractions.swift','utf8');
      assert.equal(createHash('sha256').update(original).digest('hex'),sha,file);
      assertInteractionThemePreservesOriginal(content,original);
      continue;
    }
    if (file.endsWith('/NativeLiveSpotifyCard.swift')) {
      // Conserve the historical Spotify card's structure, links, details,
      // error and state handling; appearance and the theme-aware panel
      // modifier that replaced its background are free.
      const original=readFileSync('tests/fixtures/spotify-surface-main-41bf880f/NativeLiveSpotifyCard.swift','utf8');
      assert.equal(createHash('sha256').update(original).digest('hex'),sha,file);
      const structure=(source:string)=>withoutSwiftPaint(source)
        .replace(/\.modifier\(NativeLiveIMessageContentPanel\([^)]*\)\)/g, '').replace(/\s+/g, '');
      assert.equal(structure(content), structure(original),
        'All Spotify result entities, links, details, error and state handling must remain historical');
      continue;
    }
    let equivalent = content;
    if (file.endsWith('/NativeLiveAssistantTurnPresentation.swift')) {
      // Accepted additive fields: thinking (65563ed6) and display-only timestamp (2e6505e0).
      // Keep the original hashes: no other projection/reconciliation change is allowed.
      for (const addition of [
        '    var visibleThinking: [NativeLiveVisibleThinkingItem] = []\n',
        '    // Preserve the timestamp while the foreground reply is generating; only hide its display.\n' +
          '    var visibleTimestamp: String? { activityProjection.turnIsActive ? nil : timestamp }\n',
      ]) {
        assert.equal(content.split(addition).length, 2, `expected one accepted addition: ${addition}`);
        equivalent = equivalent.replace(addition, '');
      }
    }
    assert.equal(createHash('sha256').update(equivalent).digest('hex'),sha,file);
  }
});
