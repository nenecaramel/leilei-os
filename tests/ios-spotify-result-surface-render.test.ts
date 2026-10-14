import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
const source = 'ios/LeileiOS/LeileiOS/Chat/MessageSurface/';
// The immutable historical row predates the explicit album-save retirement.
// Remove that badge/readback in the generated copy, retaining all other UI/actions.
function adaptRetiredAlbumSurface(s: string) {
 for (const retired of [
  '            AlbumSaveIndicator(count:turn.parentUserMessageID.flatMap { appModel.albumSavesByUserMessageID[$0]?.total } ?? 0)\n',
  '            if let user = turn.parentUserMessageID { await appModel.refreshAlbumSaves(userMessageID:user,force:isCurrentHead) }\n',
 ]) {
  assert.ok(s.includes(retired), 'Pinned album retirement boundary changed');
  s=s.replace(retired,'');
 }
 return s;
}
// Approved process chrome now puts timestamps in the shared action footer.
// This historical row already calls that footer, so remove only its old copy
// and add the approved activity-to-body gap (cccf6e6e / a553c665).
function approvedHistoricalProcessChrome(s: string) {
 const replacePinned = (before: string, after: string) => {
  assert.equal(s.split(before).length,2,'Pinned Spotify baseline chrome boundary changed');
  s=s.replace(before,after);
 };
 replacePinned('timestampText:turn.timestamp.map { MessageTimestampFormatter.string(from:$0) },header:turn.header,','header:turn.header,');
 replacePinned(`} else if let timestamp = turn.timestamp {
            Text(MessageTimestampFormatter.string(from:timestamp)).font(.system(size:13.5)).foregroundStyle(.secondary)
        }`,'}');
 replacePinned('            activityArea\n','            activityArea\n                .padding(.bottom, turn.stepCount > 0 && !turn.bodyPresentation.nodes.isEmpty ? 12 : 0)\n');
 return s;
}
const archivedReferenceRoot='tests/fixtures/spotify-result-surface-main-c47b0975/';
function verifySharedVisualSources() {
 const raw=readFileSync(archivedReferenceRoot+'shared-visual-source-sha256.json','utf8');
 assert.equal(createHash('sha256').update(raw).digest('hex'),'2ac8b9c6ab8d05bae62740530c5a4e26d2260af0ba879c64f7189da0687b4b1f','Immutable visual dependency pins changed');
 const pins=JSON.parse(raw) as {commit:string;sources:Record<string,string>};
 assert.equal(pins.commit,'452bd750');
 for (const [file,sha] of Object.entries(pins.sources)) {
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),sha,`Shared visual source changed; review its historical oracle: ${file}`);
 }
}
type RectTuple=[number,number,number,number];
type GeometryManifest=Record<string,Record<string,RectTuple>>;
function compareOriginalIntrinsicGeometry(current:GeometryManifest,original:GeometryManifest) {
 assert.deepEqual(Object.keys(current).sort(),Object.keys(original).sort(),'Historical snapshot case coverage changed');
 for (const [name,frames] of Object.entries(original)) {
  const actual=current[name];
  assert.deepEqual(Object.keys(actual).sort(),Object.keys(frames).sort(),`Historical snapshot frame coverage changed: ${name}`);
  for (const [key,old] of Object.entries(frames)) {
   assert.equal(actual[key].length,4);
   if (key==='activity') assert.deepEqual(actual[key],old,`Activity geometry changed: ${name}`);
   else if (key==='row') assert.deepEqual(actual[key].slice(0,3),old.slice(0,3),`Row origin/width changed: ${name}`);
   else {
    assert.ok(key==='body'||key.startsWith('card-'),`Unclassified historical geometry: ${key}`);
    assert.deepEqual([actual[key][0],...actual[key].slice(2)],[old[0],...old.slice(2)],`Historical body/card intrinsic geometry changed: ${name}/${key}`);
   }
  }
  const cards=Object.keys(frames).filter(k=>k.startsWith('card-')).sort((a,b)=>frames[a][1]-frames[b][1]);
  for (let i=1;i<cards.length;i++) {
   const first=cards[i-1],second=cards[i];
   assert.equal(actual[second][1]-(actual[first][1]+actual[first][3]),frames[second][1]-(frames[first][1]+frames[first][3]),`Historical card gap changed: ${name}`);
  }
 }
}
test('real AssistantTurn Spotify snapshots, collapse geometry, details and no-Spotify exact-main pixels', {
 skip: !process.env.SPOTIFY_SIMULATORS ? 'Requires SPOTIFY_SIMULATORS' : false,
}, () => {
 const dir=process.env.SPOTIFY_RENDER_CACHE!;
 assert.ok(dir);
 assert.notEqual(process.env.SPOTIFY_SURFACE_RECORD,'1','Historical manifests are immutable; acceptance cannot re-record them');
 verifySharedVisualSources();
 mkdirSync(dir,{recursive:true});
 cpSync('ios/LeileiOS',path.join(dir,'ios'),{recursive:true,filter:p=>!p.includes('xcuserdata')});
 const root=path.join(dir,'ios/LeileiOS/Chat/MessageSurface');
 const row=readFileSync(source+'NativeLiveAssistantTurnRow.swift','utf8');
 function instrumentRow(s:string) { return s.replace('            activityArea','            activityArea.spotifyFrame("activity")').replace('.textSelection(.enabled)','.textSelection(.enabled).spotifyFrame("body")').replace('.task(id:turn.canonicalMessageID)', '.spotifyFrame("row")\n.task(id:turn.canonicalMessageID)'); }
 const baseline=readFileSync(archivedReferenceRoot+'pre-spotify-41bf.swift','utf8');
 assert.equal(createHash('sha256').update(baseline).digest('hex'),'d0050ba68c5945e280b036f961d28ed06dcb02512fed92f8d91df18b97c09d2e','Immutable 41bf880f assistant row changed');
 writeFileSync(path.join(root,'BaselineAssistantRow.swift'),instrumentRow(approvedHistoricalProcessChrome(adaptRetiredAlbumSurface(baseline))).replaceAll('NativeLiveAssistantTurnRow','BaselineAssistantTurnRow'));
 const reference=readFileSync(archivedReferenceRoot+'NativeLiveAssistantTurnRow.swift','utf8');
 assert.equal(createHash('sha256').update(reference).digest('hex'),'00285aa81d30159a588300217235b52dddeb926e275f87e71e4de0ff88e7d591','Immutable c47b0975 Spotify row changed');
 writeFileSync(path.join(root,'HistoricalSpotifyAssistantRow.swift'),instrumentRow(approvedHistoricalProcessChrome(adaptRetiredAlbumSurface(reference))).replaceAll('NativeLiveAssistantTurnRow','HistoricalSpotifyAssistantTurnRow'));
 let current=row;
 if(process.env.SPOTIFY_RENDER_MUTATION==='collapse') {
  const rejected=current.replace('if !items.isEmpty {','if !items.isEmpty && appModel.nativeLiveMessageUIState[turn.id].isActivityExpanded {');
  assert.notEqual(rejected,current,'Collapse mutation must affect the current Spotify surface');
  current=rejected;
 }
 if(process.env.SPOTIFY_RENDER_MUTATION==='font') {
  const surfaceCall='NativeLiveSpotifyResultSurface(items: items)';
  assert.equal(current.split(surfaceCall).length,2,'Current Spotify surface call changed');
  current=current.replace(surfaceCall,'MutatedNativeLiveSpotifyResultSurface(items: items)');
 }
 writeFileSync(path.join(root,'NativeLiveAssistantTurnRow.swift'),instrumentRow(current));
 let surface=readFileSync(source+'NativeLiveSpotifyResultSurface.swift','utf8').replace('NativeLiveSpotifyCard(presentation: item.presentation, tool: item.tool)','NativeLiveSpotifyCard(presentation: item.presentation, tool: item.tool).spotifyFrame("card-\\(item.id)").spotifyItem(item)');
 writeFileSync(path.join(root,'NativeLiveSpotifyResultSurface.swift'),surface);
 // A current-only fault proves the frozen historical oracle does not mutate with it.
 // It is never used as the historical baseline, and normal acceptance adds no fault.
 if(process.env.SPOTIFY_RENDER_MUTATION==='font') {
  const originalCard=readFileSync(source+'NativeLiveSpotifyCard.swift','utf8');
  const oldFont='Text("Spotify").font(.caption)';
  assert.equal(originalCard.split(oldFont).length,2,'Pinned card title font changed');
  const badCard=originalCard.replace(oldFont,'Text("Spotify").font(.system(size: 18))')
   .replace(/\bNativeLiveSpotifyCard\b/g,'MutatedNativeLiveSpotifyCard')
   .replace(/\bNativeLiveSpotifyEntityRow\b/g,'MutatedNativeLiveSpotifyEntityRow');
  writeFileSync(path.join(root,'MutatedNativeLiveSpotifyCard.swift'),badCard.replace('Button { isShowingDetails = true } label:', 'Button(action: SpotifyProbe.capture("info", { isShowingDetails = true }))'));
  writeFileSync(path.join(root,'MutatedNativeLiveSpotifyResultSurface.swift'),surface
   .replace(/\bNativeLiveSpotifyResultSurface\b/g,'MutatedNativeLiveSpotifyResultSurface')
   .replace(/\bNativeLiveSpotifyCard\b/g,'MutatedNativeLiveSpotifyCard'));
 }

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
   {
    const original=readFileSync(path.join(approved,'manifest.json'),'utf8');
    const originalSHA=device==='iphone'?'4158a1f283b7308f86cbc91ad744f4600c659512abb94f2fb351f490ac8c7e24':'71f896de0997aeb795963c70bb67ba939455fd77a63f379e0b2dc431ab5c374a';
    assert.equal(createHash('sha256').update(original).digest('hex'),originalSHA,'Immutable original manifest changed');
    compareOriginalIntrinsicGeometry(JSON.parse(readFileSync(path.join(snapshots,'manifest.json'),'utf8')),JSON.parse(original));
   }
  } finally {spawnSync('xcrun',['simctl','uninstall',sim,bundle]);}
 }
});
