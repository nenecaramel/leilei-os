import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
const source = 'ios/LeileiOS/LeileiOS/Chat/MessageSurface/';
test('real AssistantTurn Spotify snapshots, collapse geometry, details and no-Spotify exact-main pixels', {
 skip: !process.env.SPOTIFY_SIMULATORS ? 'Requires SPOTIFY_SIMULATORS' : false,
}, () => {
 const dir=process.env.SPOTIFY_RENDER_CACHE!;
 assert.ok(dir);
 mkdirSync(dir,{recursive:true});
 cpSync('ios/LeileiOS',path.join(dir,'ios'),{recursive:true,filter:p=>!p.includes('xcuserdata')});
 const root=path.join(dir,'ios/LeileiOS/Chat/MessageSurface');
 const row=readFileSync(source+'NativeLiveAssistantTurnRow.swift','utf8');
 function instrumentRow(s:string) { return s.replace('            activityArea','            activityArea.spotifyFrame("activity")').replace('.textSelection(.enabled)','.textSelection(.enabled).spotifyFrame("body")').replace('.task(id:turn.canonicalMessageID)', '.spotifyFrame("row")\n.task(id:turn.canonicalMessageID)'); }
 const baseline=spawnSync('git',['show','41bf880f24a5d42dd48fb39603c47080b3ec75bd:'+source+'NativeLiveAssistantTurnRow.swift'],{encoding:'utf8'});
 assert.equal(baseline.status,0);
 writeFileSync(path.join(root,'BaselineAssistantRow.swift'),instrumentRow(baseline.stdout).replaceAll('NativeLiveAssistantTurnRow','BaselineAssistantTurnRow'));
 let current=row;
 if(process.env.SPOTIFY_RENDER_MUTATION==='collapse') current=current.replace('if !items.isEmpty {','if !items.isEmpty && appModel.nativeLiveMessageUIState[turn.id].isActivityExpanded {');
 writeFileSync(path.join(root,'NativeLiveAssistantTurnRow.swift'),instrumentRow(current));
 let surface=readFileSync(source+'NativeLiveSpotifyResultSurface.swift','utf8').replace('NativeLiveSpotifyCard(presentation: item.presentation, tool: item.tool)','NativeLiveSpotifyCard(presentation: item.presentation, tool: item.tool).spotifyFrame("card-\\(item.id)").spotifyItem(item)');
 writeFileSync(path.join(root,'NativeLiveSpotifyResultSurface.swift'),surface);
 for(const file of ['NativeLiveSpotifyCard.swift','NativeLiveToolActivity.swift']) {
  const s=readFileSync(source+file,'utf8');
  const key=file.includes('SpotifyCard')?'info':'generic-\\(toolName)';
  writeFileSync(path.join(root,file),s.replace('Button {\n            isShowingDetails = true\n        } label:',`Button(action: SpotifyProbe.capture("${key}", { isShowingDetails = true }))`).replace('Button { isShowingDetails = true } label:',`Button(action: SpotifyProbe.capture("${key}", { isShowingDetails = true }))`));
 }
 const sheets=readFileSync(source+'NativeLiveActivitySheets.swift','utf8');
 const sheetStart=sheets.indexOf('struct NativeLiveToolDetailSheet:');
 writeFileSync(path.join(root,'NativeLiveActivitySheets.swift'),sheets.slice(0,sheetStart)+sheets.slice(sheetStart).replace('var body: some View {', 'var body: some View {\n        let _ = SpotifyProbe.observeDetails([title,status,sectionTitle,detail,secondarySectionTitle,secondaryDetail,tertiarySectionTitle,tertiaryDetail], dismiss: { dismiss() })'));
 writeFileSync(path.join(dir,'ios/LeileiOS/App/LeileiOSApp.swift'),readFileSync('tests/fixtures/ios-spotify-result-surface-render.swift','utf8'));
 const bundle='com.leileios.tests.spotify-surface';
 const build=spawnSync('xcodebuild',['-project',path.join(dir,'ios/LeileiOS.xcodeproj'),'-scheme','LeileiOS','-destination','generic/platform=iOS Simulator','-derivedDataPath',path.join(dir,'build'),'-clonedSourcePackagesDirPath',path.join(dir,'packages'),'CODE_SIGNING_ALLOWED=NO','COMPILER_INDEX_STORE_ENABLE=NO','DEBUG_INFORMATION_FORMAT=dwarf','SWIFT_OPTIMIZATION_LEVEL=-Onone','ARCHS=arm64','ONLY_ACTIVE_ARCH=YES',`PRODUCT_BUNDLE_IDENTIFIER=${bundle}`,'build'],{encoding:'utf8',timeout:600000,maxBuffer:40_000_000});
 writeFileSync(path.join(dir,'build.log'),build.stdout+build.stderr);
 assert.equal(build.status,0,(build.stdout+build.stderr).split('\n').filter(l=>l.includes('error:')).join('\n'));
 for(const sim of process.env.SPOTIFY_SIMULATORS!.split(',')) {
  try {
   const installed=spawnSync('xcrun',['simctl','install',sim,path.join(dir,'build/Build/Products/Debug-iphonesimulator/LeileiOS.app')],{encoding:'utf8'});assert.equal(installed.status,0,installed.stderr);
   const log=path.join(dir,sim+'.log'),fd=openSync(log,'w');
   const run=spawnSync('xcrun',['simctl','launch','--console','--terminate-running-process',sim,bundle],{stdio:['ignore',fd,fd],timeout:120000});closeSync(fd);
   const output=readFileSync(log,'utf8');assert.equal(run.status,0,output);assert.match(output,/Spotify surface render PASS/);console.info(output.trim());
   const container=spawnSync('xcrun',['simctl','get_app_container',sim,bundle,'data'],{encoding:'utf8'});assert.equal(container.status,0);
   const snapshots=path.join(container.stdout.trim(),'Documents/SpotifySurface');
   cpSync(snapshots,path.join(dir,sim+'-snapshots'),{recursive:true});
   const device=output.includes('device=UIUserInterfaceIdiom(rawValue: 1)')?'ipad':'iphone';
   const approved='tests/fixtures/spotify-surface-snapshots/'+device;
   if(process.env.SPOTIFY_SURFACE_RECORD==='1') cpSync(snapshots,approved,{recursive:true});
   else assert.deepEqual(JSON.parse(readFileSync(path.join(snapshots,'manifest.json'),'utf8')),JSON.parse(readFileSync(path.join(approved,'manifest.json'),'utf8')),'Approved standalone geometry changed');
  } finally {spawnSync('xcrun',['simctl','uninstall',sim,bundle]);}
 }
});
