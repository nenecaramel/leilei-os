import AVFoundation
import Foundation

// Fault injection exists only in the compiled test copy, never in production.
@MainActor enum SessionProbe {
    static var failPlay = false
    static var failActivate = false
    static var failCategory = false
    static var configurations = 0
    static var activations = 0
    static var deactivations = 0
    static func configure(_ session: AVAudioSession) throws {
        if failCategory { throw NSError(domain: "test.category", code: 1) }
        configurations += 1
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
        let sentinel: AVAudioSession.Category = .soloAmbient
        let options: AVAudioSession.CategoryOptions = []
        func seed() throws {
            try session.setActive(false, options: .notifyOthersOnDeactivation)
            try session.setCategory(sentinel, mode: .default, options: options)
        }
        func restored(_ path: String) {
            precondition(session.category == sentinel && session.mode == .default && session.categoryOptions == options, "\(path) must preserve normal configuration")
        }
        func playing() { restored("playback"); }
        func wav(_ seconds: Double) -> Data {
            let count=Int(8000*seconds); var data=Data()
            func u16(_ v: UInt16) { var x=v.littleEndian; withUnsafeBytes(of:&x) { data.append(contentsOf:$0) } }
            func u32(_ v: UInt32) { var x=v.littleEndian; withUnsafeBytes(of:&x) { data.append(contentsOf:$0) } }
            data.append(Data("RIFF".utf8)); u32(UInt32(36+count*2)); data.append(Data("WAVEfmt ".utf8)); u32(16); u16(1); u16(1); u32(8000); u32(16000); u16(2); u16(16); data.append(Data("data".utf8)); u32(UInt32(count*2)); data.append(Data(count:count*2)); return data
        }
        let short=wav(0.15), long=wav(3)
        // These are real active sentinel sessions, not a simulated isActive flag.
        for (category, mode, options) in [
            (AVAudioSession.Category.playAndRecord, AVAudioSession.Mode.voiceChat, AVAudioSession.CategoryOptions.defaultToSpeaker),
            (.record, .measurement, .duckOthers)
        ] {
            try session.setCategory(category, mode: mode, options: options)
            try session.setActive(true)
            let original = (session.category, session.mode, session.categoryOptions)
            let attempts = (SessionProbe.activations, SessionProbe.deactivations, SessionProbe.configurations)
            let blocked = NativeLiveAudioPlaybackState()
            var loads = 0
            await blocked.toggle { loads += 1; return long }
            precondition(blocked.phase == .failed, "Pre-existing active voice/record session must reject bubble acquire")
            precondition(session.category == original.0 && session.mode == original.1 && session.categoryOptions == original.2, "Active sentinel configuration must not be overwritten")
            precondition(loads == 0 && blocked.player == nil, "Reject before constructing/preparing a player under an incompatible session")
            let rejectedRelease = NativeLiveAudioPlaybackState()
            await rejectedRelease.toggle { loads += 1; return long }
            precondition(rejectedRelease.phase == .failed && loads == 0)
            rejectedRelease.deactivate(); rejectedRelease.deactivate()
            precondition(SessionProbe.activations == attempts.0 && SessionProbe.deactivations == attempts.1 && SessionProbe.configurations == attempts.2, "Rejected acquire/release must not touch another active owner's session")
            // The original owner, not the bubble, ends its own activation.
            try session.setActive(false, options: .notifyOthersOnDeactivation)
            try seed()
            await blocked.toggle { short }
            precondition(blocked.phase == .playing && blocked.player!.isPlaying, "Retry directly from failed state must leave no stale lease")
            blocked.deactivate(); restored("retry after incompatible owner releases")
            print("Active sentinel PASS: \(category.rawValue) / \(mode.rawValue)")
        }
        // Also reject an incompatible INACTIVE configuration. Never infer that
        // recording configuration implies it is safe to take activation ownership.
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: .defaultToSpeaker)
        let inactiveVoice = NativeLiveAudioPlaybackState()
        await inactiveVoice.toggle { long }; precondition(inactiveVoice.phase == .failed)
        inactiveVoice.deactivate()
        precondition(session.category == .playAndRecord && session.mode == .voiceChat)
        try seed()
        // Verify every allowed output category with a genuinely inactive seed.
        for category in [AVAudioSession.Category.ambient, .soloAmbient, .playback] {
            try session.setActive(false, options: .notifyOthersOnDeactivation)
            try session.setCategory(category, mode: .default, options: [])
            let config = (session.category, session.mode, session.categoryOptions)
            let normal = NativeLiveAudioPlaybackState()
            await normal.toggle { short }
            precondition(normal.phase == .playing && normal.player!.isPlaying)
            try await Task.sleep(for:.milliseconds(450))
            precondition(normal.phase == .ready)
            normal.deactivate()
            precondition(session.category == config.0 && session.mode == config.1 && session.categoryOptions == config.2)
            print("Inactive output PASS: \(category.rawValue)")
        }
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
        precondition(SessionProbe.activations == acquisitions, "Pause/resume must reuse the same lease")
        pause.deactivate(); restored("pause/resume deactivate")
        let failure=NativeLiveAudioPlaybackState()
        await failure.toggle { long }; playing()
        failure.audioPlayerDecodeErrorDidOccur(failure.player!, error: nil)
        try await Task.sleep(for:.milliseconds(80)); precondition(failure.phase == .failed); restored("decode failure")
        SessionProbe.failPlay=true
        let start=NativeLiveAudioPlaybackState(); await start.toggle { long }
        SessionProbe.failPlay=false
        precondition(start.phase == .failed); restored("play start failure")
        // Compatible already-active playback is reused without taking ownership.
        try session.setCategory(.playback, mode: .default, options: .mixWithOthers)
        try session.setActive(true)
        let foreignPlayer = try AVAudioPlayer(data: wav(5))
        precondition(foreignPlayer.play())
        let foreignTime = foreignPlayer.currentTime
        let borrowed = NativeLiveAudioPlaybackState(); await borrowed.toggle { short }
        try await Task.sleep(for:.milliseconds(450))
        precondition(borrowed.phase == .ready && foreignPlayer.isPlaying && foreignPlayer.currentTime > foreignTime, "Bubble finish must not deactivate compatible pre-existing playback")
        borrowed.deactivate()
        precondition(foreignPlayer.isPlaying && session.category == .playback && session.categoryOptions == .mixWithOthers)
        foreignPlayer.stop(); try session.setActive(false, options: .notifyOthersOnDeactivation)
        try seed()
        let a=NativeLiveAudioPlaybackState(), b=NativeLiveAudioPlaybackState()
        let concurrentReleases = SessionProbe.deactivations
        let concurrentAcquisitions = SessionProbe.activations
        await a.toggle { short }; await b.toggle { long }; playing()
        precondition(SessionProbe.activations == concurrentAcquisitions)
        try await Task.sleep(for:.milliseconds(450))
        precondition(a.phase == .ready && b.phase == .playing && b.player!.isPlaying && b.player!.currentTime > 0); playing()
        precondition(SessionProbe.deactivations == concurrentReleases, "First owner must not deactivate the remaining player")
        b.deactivate(); restored("last concurrent owner")
        precondition(SessionProbe.deactivations == concurrentReleases)
        // Idempotent release cannot deactivate a newly acquired independent owner.
        await a.toggle { long }; b.deactivate(); playing(); a.deactivate(); restored("idempotent release")
        // Voice takes over after audio acquired. Audio release must not restore
        // an old snapshot over the new voice configuration or deactivate it.
        let takeover = NativeLiveAudioPlaybackState(); await takeover.toggle { long }
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true)
        let takeoverConfig = (session.category, session.mode, session.categoryOptions)
        let beforeTakeoverRelease = SessionProbe.deactivations
        takeover.deactivate()
        precondition(session.category == takeoverConfig.0 && session.mode == takeoverConfig.1 && session.categoryOptions == takeoverConfig.2)
        precondition(SessionProbe.deactivations == beforeTakeoverRelease)
        try session.setActive(false, options: .notifyOthersOnDeactivation); try seed()
        weak var gone: NativeLiveAudioPlaybackState?
        do { let disposable=NativeLiveAudioPlaybackState(); gone=disposable; await disposable.toggle { long } }
        try await Task.sleep(for:.milliseconds(100)); precondition(gone == nil); restored("deinit")
        precondition(SessionProbe.activations == 0 && SessionProbe.deactivations == 0 && SessionProbe.configurations == 0, "Unknown activation ownership must never cause an explicit session mutation")
    }
}
@main struct SessionTestApp {
    @MainActor static func main() async {
        do { try await SessionChecks().check(); print("AudioSession ownership PASS"); exit(0) }
        catch { print("AudioSession test error: \(error)"); exit(1) }
    }
}
