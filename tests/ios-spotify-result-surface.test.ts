import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
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
  assert.match(assistant, /activityArea\s+spotifyResultArea\s+NativeLiveMessagePresentationView/);
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

test('projection, reconciliation, Spotify schema/card and voice production stay byte-identical to main', () => {
  // Frozen hashes also work in CI's shallow checkout; never require old Git objects.
  const manifest=JSON.parse(readFileSync('tests/fixtures/spotify-surface-main-41bf880f.json','utf8'));
  assert.equal(manifest.ref,'41bf880f24a5d42dd48fb39603c47080b3ec75bd');
  for (const [file,sha] of Object.entries(manifest.sha256)) {
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),sha,file);
  }
});
