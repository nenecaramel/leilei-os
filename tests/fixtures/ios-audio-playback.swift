import Foundation
import AVFoundation
@main struct AudioPlaybackChecks {
 @MainActor static func main() async throws {
  func wav(_ seconds:Double) -> Data {
   let count = Int(8000*seconds); var data = Data()
   func u16(_ v:UInt16) { var x=v.littleEndian; withUnsafeBytes(of:&x) { data.append(contentsOf:$0) } }
   func u32(_ v:UInt32) { var x=v.littleEndian; withUnsafeBytes(of:&x) { data.append(contentsOf:$0) } }
   data.append(Data("RIFF".utf8)); u32(UInt32(36+count*2)); data.append(Data("WAVEfmt ".utf8)); u32(16); u16(1); u16(1); u32(8000); u32(16000); u16(2); u16(16); data.append(Data("data".utf8)); u32(UInt32(count*2)); data.append(Data(count:count*2)); return data
  }
  let bytes=wav(1), reference=try AVAudioPlayer(data:bytes)
  let state=NativeLiveAudioPlaybackState(); var downloads=0
  let load: () async throws -> Data = { downloads += 1; try await Task.sleep(for:.milliseconds(40)); return bytes }
  async let a: Void=state.prepare(load:load)
  async let b: Void=state.prepare(load:load)
  _ = await (a,b)
  precondition(downloads == 1 && state.phase == .ready)
  precondition(state.duration == reference.duration && state.duration == 1)
  await state.toggle(load:load)
  precondition(state.phase == .playing)
  try await Task.sleep(for:.milliseconds(170))
  precondition(state.currentTime > 0 && state.progress > 0 && state.progress <= 1)
  await state.toggle(load:load); precondition(state.phase == .paused)
  let paused=state.currentTime
  try await Task.sleep(for:.milliseconds(80)); precondition(state.currentTime == paused)
  await state.toggle(load:load); precondition(state.phase == .playing)
  try await Task.sleep(for:.milliseconds(1200))
  precondition(state.phase == .ready && state.currentTime == state.duration)
  await state.toggle(load:load); precondition(state.phase == .playing && state.currentTime < 0.1)
  precondition(downloads == 1)
  state.deactivate(); precondition(state.phase == .idle && state.verifiedData == nil && state.duration == 0)
  let failed=NativeLiveAudioPlaybackState()
  await failed.prepare { throw NativeLiveMediaError.integrityFailed }
  precondition(failed.phase == .failed && failed.error == NativeLiveMediaError.integrityFailed.localizedDescription)
  await failed.prepare { bytes }; precondition(failed.phase == .ready)
  failed.deactivate()
  let rapid=NativeLiveAudioPlaybackState(); let countBefore=downloads
  async let first: Void=rapid.toggle(load:load)
  async let second: Void=rapid.toggle(load:load)
  _ = await (first,second)
  precondition(rapid.phase == .playing && downloads == countBefore+1)
  rapid.deactivate(); let stoppedTime=rapid.currentTime
  try await Task.sleep(for:.milliseconds(150)); precondition(rapid.currentTime == stoppedTime && rapid.phase == .idle)
  weak var released: NativeLiveAudioPlaybackState?
  do { let disposable=NativeLiveAudioPlaybackState(); released=disposable; await disposable.toggle(load:load) }
  try await Task.sleep(for:.milliseconds(150)); precondition(released == nil, "Timer/player must not retain playback owner")
  let late=NativeLiveAudioPlaybackState()
  let task=Task { await late.prepare(load:load) }; await Task.yield(); late.deactivate(); await task.value
  precondition(late.phase == .idle && late.verifiedData == nil)
  print("Audio playback PASS: real duration/progress, replay, failure, single flight, late completion disposal")
 }
}
