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
test('AudioSession fix leaves VoiceInputController and every other production file unchanged from PR head',()=>{
 assert.equal(createHash("sha256").update(readFileSync("tests/fixtures/audio-session-pre-fix-4a3761ff.swift")).digest("hex"),"0a4c0ea5bc9e8da7e9581c20cb65d7f79ddb17715da6965b5f797af89abc4d4e","Pre-fix witness must remain the exact original production source");
 assert.doesNotMatch(readFileSync(source,'utf8'), /\.set(?:Category|Active)\s*\(/, "Borrower must never mutate process session configuration or activation");
 const unchanged={
  "ios/LeileiOS/LeileiOS/Chat/VoiceInputController.swift": "41fca49bfdd61d703af06331b669aa74f513e62c29f54a240362c6803e9f76f7",
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveAudioAttachmentBubble.swift": "0f72414c8dcdd14d98c27783ffa6aa2105256b7ba93a750f5fecb076966c5e43",
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMediaPresentation.swift": "128ed1b27c661b96a088701bf633d0bf768c2cc73447ed3a100b8d6664554bf8",
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMediaRenderer.swift": "3e8135e44bd4d2e7245938652b27989bf7e4f1dd88de9264ec31f8be69d4d5d7",
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveToolActivity.swift": "493ab18ea911102b6cf00cb21fd705c35908b1224bb9d6f06e3c2c2270e80a20",
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveSpotifyCard.swift": "e09a6002e6cf8ac083e4ee0ee490871fc870ffdb1de240530d68a0593a983875",
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveSpotifyPresentation.swift": "6a4de7a315406ce3a72ed72a4a3dfdcef9120f1b9f438075aa9f906a4f569ccb"
};
 for(const [file,sha] of Object.entries(unchanged)) assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"),sha,file);
 const bubble=readFileSync('ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveAudioAttachmentBubble.swift','utf8');
 assert.match(bubble,/\.onDisappear \{ playback.deactivate\(\) \}/);
});
