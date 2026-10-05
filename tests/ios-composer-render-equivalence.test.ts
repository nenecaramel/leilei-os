import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';

const files = ['ChatComposer.swift','ComposerComponents.swift','ChatPresentationLayout.swift'];
function instrument(source: string, file: string) {
  source = source.replace(/\.frame\(height: (34|ChatPresentationLayout\.composerEditHeight)\)/g, '$&\n.chatFrame("edit")')
    .replace(/\.frame\(height: (54|55|ChatPresentationLayout\.composerAttachmentHeight)\)/g, '$&\n.chatFrame("attachment-chip.\\(attachment.id)")')
    .replace('.controlSize(.mini)', '.controlSize(.mini)\n.chatFrame("attachment-progress.\\(attachment.id)")')
    .replace('.equatable()', '.equatable()\n.chatFrame("input")')
    .replace(/ComposerCircleButton\(\s*systemName: "plus",\s*weight: \.light\s*\)/g, '$&.chatFrame("plus")')
    .replace(/systemName: "chevron.down"\s*\)/g, '$&.chatFrame("keyboard-dismiss")')
    .replace(/effort: effort.displayName\s*\)/g, '$&.chatFrame("model")');
  // Anchor the primary circle at the same paint boundary before/after extraction.
  if (source.includes('Circle()\n                .fill(.black)') || file === 'ComposerPresentationComponents.swift') {
    source = source.replace(/\.frame\(width: LeileiUI.ControlGeometry.compact, height: LeileiUI.ControlGeometry.compact\)/, '$&\n.chatFrame("primary-action")');
  }
  if (file === 'ChatComposer.swift') {
    source += `\nextension ChatComposer {
      func fixtureAction() -> [String] { [actionPresentation.symbol,String(describing:actionPresentation.weight),String(actionPresentation.isDimmed),String(describing:actionPresentation.mode)] }
      func fixtureSelectModel(_ value:NativeLiveClaudeModel) { modelSelection.wrappedValue = value }
      func fixtureSelectThinking(_ value:NativeLiveThinkingMode) { thinkingSelection.wrappedValue = value }
    }\n`;
  }
  return source.replace(/\.glassEffect\(/g, ".chatTestGlass(");
}

test('Composer renders and selection rules match main f7a254cc and reject changed attachment geometry', {
  skip: process.platform !== 'darwin' || !process.env.UI_COMPOSER_SIMULATOR_ID ? 'Requires macOS and UI_COMPOSER_SIMULATOR_ID' : false,
}, () => {
  const dir = process.env.UI_COMPOSER_RENDER_CACHE ?? mkdtempSync(path.join(os.tmpdir(),'leilei-composer-render-'));
  mkdirSync(dir,{recursive:true});
  const simulator = process.env.UI_COMPOSER_SIMULATOR_ID!;
  const bundle = 'com.leileios.tests.composer-equivalence';
  try {
    cpSync('ios/LeileiOS',path.join(dir,'ios'),{recursive:true,preserveTimestamps:true,filter:p=>!p.includes('xcuserdata')});
    const root = path.join(dir,'ios/LeileiOS');
    const original = files.map(f=>readFileSync('tests/fixtures/composer-main-f7a254cc/'+f,'utf8'));
    const names = new Set(original.flatMap(s=>[...s.matchAll(/\b(?:struct|class|enum|protocol)\s+(\w+)/g)].map(m=>m[1])));
    names.add('chatSoftFill');
    const moved = ['ComposerPresentationComponents.swift','ComposerAttachmentStrip.swift','ComposerVoiceActionControl.swift'];
    for (const file of moved) { const p=path.join(root,'Chat',file); if (existsSync(p)) writeFileSync(p,instrument(readFileSync(p,'utf8'),file)); }
    const renamed = (s:string)=>s.replace(new RegExp('\\b('+[...names].join('|')+')\\b','g'),n=>'Baseline'+n);
    for (let i=0;i<files.length;i++) {
      const file=files[i];
      writeFileSync(path.join(root,'Chat',file),instrument(readFileSync('ios/LeileiOS/LeileiOS/Chat/'+file,'utf8'),file));
      writeFileSync(path.join(root,'Chat','Baseline'+path.basename(file)),renamed(instrument(original[i],file)));
    }
    const rejectedNames=[...names];
    const rejected=instrument(original[0].replace('.frame(height: 54)', '.frame(height: 55)'), 'ChatComposer.swift').replace(new RegExp('\\b('+rejectedNames.join('|')+')\\b','g'),n=>'Rejected'+n);
    assert.ok(rejected.includes('.frame(height: 55)'), 'negative control must change the real attachment chip height');
    for (let i=0;i<files.length;i++) {
      const content=i === 0 ? rejected : instrument(original[i],files[i]).replace(new RegExp('\\b('+rejectedNames.join('|')+')\\b','g'),n=>'Rejected'+n);
      writeFileSync(path.join(root,'Chat','Rejected'+files[i]),content);
    }
    writeFileSync(path.join(root,'App/LeileiOSApp.swift'),readFileSync('tests/fixtures/ios-composer-render-equivalence.swift','utf8'));
    const build = spawnSync('xcodebuild',['-project',path.join(dir,'ios/LeileiOS.xcodeproj'),'-scheme','LeileiOS','-sdk','iphonesimulator','-destination','generic/platform=iOS Simulator','-derivedDataPath',path.join(dir,'build'),'CODE_SIGNING_ALLOWED=NO',`PRODUCT_BUNDLE_IDENTIFIER=${bundle}`,'build'],{encoding:'utf8',timeout:600_000,maxBuffer:30_000_000});
    writeFileSync(path.join(dir,'build.log'),build.stdout+build.stderr);
    assert.equal(build.status,0,(build.stdout+build.stderr).split('\n').filter(l=>l.includes('error:')).join('\n'));
    const app=path.join(dir,'build/Build/Products/Debug-iphonesimulator/LeileiOS.app');
    const install=spawnSync('xcrun',['simctl','install',simulator,app],{encoding:'utf8'}); assert.equal(install.status,0,install.stderr);
    const runLog=path.join(dir,'run.log'); const fd=openSync(runLog,'w');
    const checked=spawnSync('xcrun',['simctl','launch','--console','--terminate-running-process',simulator,bundle],{encoding:'utf8',stdio:['ignore',fd,fd],timeout:600_000,maxBuffer:10_000_000,env:{...process.env,SIMCTL_CHILD_COMPOSER_NEGATIVE:process.env.UI_COMPOSER_NEGATIVE ?? '0'}});
    closeSync(fd);const output=readFileSync(runLog,'utf8');console.info(output.trim()); assert.ifError(checked.error); assert.equal(checked.status,0,output); assert.match(output,/Composer render equivalence PASS/);
  } finally {
    spawnSync('xcrun',['simctl','uninstall',simulator,bundle]); if (!process.env.UI_COMPOSER_RENDER_CACHE) rmSync(dir,{recursive:true,force:true});
  }
});
