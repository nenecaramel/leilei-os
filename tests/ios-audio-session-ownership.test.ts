import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
const source='ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveAudioPlaybackState.swift';
test('real iOS AudioSession refuses active voice/recording and borrows normal playback without stealing activation', {
 skip:process.platform!=='darwin'||!process.env.UI_AUDIO_SESSION_SIMULATOR_ID?'Requires UI_AUDIO_SESSION_SIMULATOR_ID':false,
},()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'leilei-session-check-')), sim=process.env.UI_AUDIO_SESSION_SIMULATOR_ID!, bundle='com.leileios.tests.audio-session';
 const run=(cmd:string,args:string[],timeout=180000)=>{const r=spawnSync(cmd,args,{encoding:'utf8',timeout,maxBuffer:20_000_000});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout+r.stderr;};
 try {
  // Expose the player for invoking its real delegate failure path; no production API seam.
  const code=readFileSync(process.env.UI_AUDIO_SESSION_PRE_FIX==='1'?'tests/fixtures/audio-session-pre-fix-4a3761ff.swift':source,'utf8').replace('private var player: AVAudioPlayer?','var player: AVAudioPlayer?').replace('guard player.play()','guard SessionProbe.play(player)').replace('try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])','try SessionProbe.configure(session)').replace('try? session.setActive(false, options: .notifyOthersOnDeactivation)','try? SessionProbe.deactivate(session)').replace('try session.setActive(true)','try SessionProbe.activate(session)').replace('try AVAudioSession.sharedInstance().setActive(true)','try SessionProbe.activate(AVAudioSession.sharedInstance())');
  writeFileSync(path.join(dir,'Playback.swift'),code);
  const app=path.join(dir,'Session.app');mkdirSync(app);
  writeFileSync(path.join(app,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundle}</string><key>CFBundleExecutable</key><string>Session</string><key>CFBundleName</key><string>Session</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>1</string><key>LSRequiresIPhoneOS</key><true/><key>UILaunchScreen</key><dict/><key>UIApplicationSceneManifest</key><dict><key>UIApplicationSupportsMultipleScenes</key><true/><key>UISceneConfigurations</key><dict/></dict></dict></plist>`);
  const sdk=run('xcrun',['--sdk','iphonesimulator','--show-sdk-path']).trim();
  run('xcrun',['--sdk','iphonesimulator','swiftc','-parse-as-library','-target','arm64-apple-ios18.0-simulator','-sdk',sdk,'-module-cache-path',path.join(dir,'cache'),path.join(dir,'Playback.swift'),'tests/fixtures/ios-audio-session.swift','-o',path.join(app,'Session')]);
  run('codesign',['--force','--sign','-',app]);run('xcrun',['simctl','install',sim,app]);
  const output=run('xcrun',['simctl','launch','--console','--terminate-running-process',sim,bundle],60000);
  assert.match(output,/AudioSession ownership PASS/);console.info(output);
 } finally {spawnSync('xcrun',['simctl','uninstall',sim,bundle]);rmSync(dir,{recursive:true,force:true});}
});
test('AudioSession ownership remains isolated to the playback borrower boundary',()=>{
 const playback=readFileSync(source,'utf8');
 assert.equal(createHash("sha256").update(readFileSync("tests/fixtures/audio-session-pre-fix-4a3761ff.swift")).digest("hex"),"0a4c0ea5bc9e8da7e9581c20cb65d7f79ddb17715da6965b5f797af89abc4d4e","Pre-fix witness must remain the exact original production source");
 assert.match(playback,/final class NativeLiveAudioSessionCoordinator/);
 assert.match(playback,/\[\.ambient, \.soloAmbient, \.playback\]\.contains\(session\.category\)/);
 assert.match(playback,/session\.mode == \.default/);
 assert.doesNotMatch(playback,/\.set(?:Category|Active)\s*\(/,"Playback borrower must never mutate process session configuration or activation");
 assert.match(playback,/NativeLiveAudioSessionCoordinator\.shared\.acquire\(borrower\)/);
 assert.match(playback,/NativeLiveAudioSessionCoordinator\.shared\.release\(borrower\)/);
 const bubble=readFileSync('ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveAudioAttachmentBubble.swift','utf8');
 assert.match(bubble,/\.onDisappear \{ playback\.deactivate\(\) \}/);
});
