import AVFoundation
import Foundation

// Fault injection exists only in the compiled test copy, never in production.
@MainActor enum SessionProbe {
    static var failPlay = false
    static var failActivate = false
    static var failCategory = false
    static var activations = 0
    static var deactivations = 0
    static func configure(_ session: AVAudioSession) throws {
        if failCategory { throw NSError(domain: "test.category", code: 1) }
        try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
    }
    static func deactivate(_ session: AVAudioSession) throws {
        deactivations += 1
        try session.setActive(false, options: .notifyOthersOnDeactivation)
    }
    static func play(_ player: AVAudioPlayer) -> Bool { failPlay ? false : player.play() }
    static func activate(_ session: AVAudioSession) throws {
        if failActivate { throw NSError(domain: "test.activation", code: 1) }
        try session.setActive(true)
        activations += 1
    }
}
enum NativeLiveMediaError: LocalizedError {
    case previewFailed
    var errorDescription: String? { "preview failed" }
}
@MainActor final class SessionChecks {
    func check() async throws {
        let session = AVAudioSession.sharedInstance()
        let sentinel: AVAudioSession.Category = .playAndRecord
        let options: AVAudioSession.CategoryOptions = [.defaultToSpeaker, .allowBluetoothHFP]
        func seed() throws { try session.setCategory(sentinel, mode: .voiceChat, options: options) }
        func restored(_ path: String) {
            precondition(session.category == sentinel && session.mode == .voiceChat && session.categoryOptions == options, "\(path) must restore sentinel category/mode/options")
        }
        func playing() { precondition(session.category == .playback && session.mode == .default && session.categoryOptions == [.mixWithOthers]) }
        func wav(_ seconds: Double) -> Data {
            let count=Int(8000*seconds); var data=Data()
            func u16(_ v: UInt16) { var x=v.littleEndian; withUnsafeBytes(of:&x) { data.append(contentsOf:$0) } }
            func u32(_ v: UInt32) { var x=v.littleEndian; withUnsafeBytes(of:&x) { data.append(contentsOf:$0) } }
            data.append(Data("RIFF".utf8)); u32(UInt32(36+count*2)); data.append(Data("WAVEfmt ".utf8)); u32(16); u16(1); u16(1); u32(8000); u32(16000); u16(2); u16(16); data.append(Data("data".utf8)); u32(UInt32(count*2)); data.append(Data(count:count*2)); return data
        }
        let short=wav(0.15), long=wav(3)
        try seed()
        let finish=NativeLiveAudioPlaybackState()
        await finish.toggle { short }; playing()
        try await Task.sleep(for: .milliseconds(450))
        precondition(finish.phase == .ready); restored("finish")
        // Replay takes a fresh lease; pause/resume must not overwrite its original snapshot.
        await finish.toggle { short }; playing(); finish.deactivate(); restored("replay deactivate")
        let pause=NativeLiveAudioPlaybackState()
        let acquisitions = SessionProbe.activations
        await pause.toggle { long }; playing()
        await pause.toggle { long }; precondition(pause.phase == .paused)
        await pause.toggle { long }; playing()
        precondition(SessionProbe.activations == acquisitions + 1, "Pause/resume must reuse the same lease")
        pause.deactivate(); restored("pause/resume deactivate")
        let failure=NativeLiveAudioPlaybackState()
        await failure.toggle { long }; playing()
        failure.audioPlayerDecodeErrorDidOccur(failure.player!, error: nil)
        try await Task.sleep(for:.milliseconds(80)); precondition(failure.phase == .failed); restored("decode failure")
        SessionProbe.failPlay=true
        let start=NativeLiveAudioPlaybackState(); await start.toggle { long }
        SessionProbe.failPlay=false
        precondition(start.phase == .failed); restored("play start failure")
        let releaseCount = SessionProbe.deactivations
        SessionProbe.failActivate=true
        let activate=NativeLiveAudioPlaybackState(); await activate.toggle { long }
        SessionProbe.failActivate=false
        precondition(activate.phase == .failed); restored("activate rollback")
        precondition(SessionProbe.deactivations == releaseCount, "Failed activation must not own/deactivate the pre-existing session")
        SessionProbe.failCategory=true
        let category=NativeLiveAudioPlaybackState(); await category.toggle { long }
        SessionProbe.failCategory=false
        precondition(category.phase == .failed); restored("category failure")
        precondition(SessionProbe.deactivations == releaseCount, "Failed category setup must not own/deactivate the session")
        // Failed acquisition must leave no stale owner to block the next restoration.
        let afterFailure=NativeLiveAudioPlaybackState(); await afterFailure.toggle { long }; playing()
        afterFailure.deactivate(); restored("after failed acquisition")
        let a=NativeLiveAudioPlaybackState(), b=NativeLiveAudioPlaybackState()
        let concurrentReleases = SessionProbe.deactivations
        let concurrentAcquisitions = SessionProbe.activations
        await a.toggle { short }; await b.toggle { long }; playing()
        precondition(SessionProbe.activations == concurrentAcquisitions + 1)
        try await Task.sleep(for:.milliseconds(450))
        precondition(a.phase == .ready && b.phase == .playing); playing()
        precondition(SessionProbe.deactivations == concurrentReleases, "First owner must not deactivate the remaining player")
        b.deactivate(); restored("last concurrent owner")
        precondition(SessionProbe.deactivations == concurrentReleases + 1)
        // Idempotent release cannot deactivate a newly acquired independent owner.
        await a.toggle { long }; b.deactivate(); playing(); a.deactivate(); restored("idempotent release")
        weak var gone: NativeLiveAudioPlaybackState?
        do { let disposable=NativeLiveAudioPlaybackState(); gone=disposable; await disposable.toggle { long } }
        try await Task.sleep(for:.milliseconds(100)); precondition(gone == nil); restored("deinit")
    }
}
@main struct SessionTestApp {
    @MainActor static func main() async {
        do { try await SessionChecks().check(); print("AudioSession ownership PASS"); exit(0) }
        catch { print("AudioSession test error: \(error)"); exit(1) }
    }
}
