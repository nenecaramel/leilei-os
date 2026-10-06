import Foundation
import Combine
import AVFoundation

#if os(iOS)
// AVAudioSession exposes configuration, not reliable in-app activation ownership.
// Borrow only a known output configuration. Never reconfigure/activate/deactivate
// the process session: it may already belong to Voice or another playback owner.
@MainActor private final class NativeLiveAudioSessionCoordinator {
    static let shared = NativeLiveAudioSessionCoordinator()
    private enum AcquisitionError: Error { case incompatibleConfiguration }
    private var borrowers: Set<UUID> = []

    func checkConfiguration() throws {
        let session = AVAudioSession.sharedInstance()
        guard [.ambient, .soloAmbient, .playback].contains(session.category), session.mode == .default else {
            throw AcquisitionError.incompatibleConfiguration
        }
    }

    func acquire(_ borrower: UUID) throws {
        try checkConfiguration()
        // A lease owns only this bubble's player, never the session's activation.
        // Check configuration again on resume and for every concurrent borrower.
        borrowers.insert(borrower)
    }

    func release(_ borrower: UUID) {
        borrowers.remove(borrower)
    }
}
#endif

@MainActor final class NativeLiveAudioPlaybackState: NSObject, ObservableObject, AVAudioPlayerDelegate {
    enum Phase { case idle, loading, ready, playing, paused, failed }
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var duration: TimeInterval = 0
    @Published private(set) var currentTime: TimeInterval = 0
    @Published private(set) var error: String?
    private(set) var verifiedData: Data?
    private var player: AVAudioPlayer?
    private var timer: Timer?
    private var generation = 0
    #if os(iOS)
    private var sessionBorrower: UUID?
    #endif
    var progress: Double { duration > 0 ? min(1, max(0, currentTime / duration)) : 0 }

    func prepare(load: () async throws -> Data) async {
        guard player == nil, phase != .loading else { return }
        phase = .loading; error = nil
        let request = generation
        do {
            let data = try await load()
            try Task.checkCancellation()
            guard request == generation else { return }
            let audio = try AVAudioPlayer(data: data)
            guard audio.prepareToPlay(), audio.duration.isFinite, audio.duration > 0 else { throw NativeLiveMediaError.previewFailed }
            audio.delegate = self
            player = audio; verifiedData = data; duration = audio.duration; currentTime = 0
            phase = .ready
        } catch {
            guard request == generation else { return }
            if error is CancellationError { phase = .idle; return }
            self.error = (error as? NativeLiveMediaError)?.localizedDescription ?? "Could not play audio. Try again."
            stopPlaybackSession()
            phase = .failed
        }
    }

    func toggle(load: () async throws -> Data) async {
        // A second rapid tap never joins a load and then starts a second player.
        guard phase != .loading else { return }
        if phase == .playing {
            player?.pause(); sampleProgress(); stopTimer(); phase = .paused
            return
        }
        #if os(iOS)
        do { try NativeLiveAudioSessionCoordinator.shared.checkConfiguration() }
        catch {
            stopPlaybackSession()
            self.error = "Could not play audio. Try again."; phase = .failed; return
        }
        #endif
        if phase == .failed { player?.stop(); player = nil }
        if player == nil {
            let cached = verifiedData
            await prepare { if let cached { return cached }; return try await load() }
        }
        guard let player, phase == .ready || phase == .paused else { return }
        if currentTime >= duration { player.currentTime = 0; currentTime = 0 }
        #if os(iOS)
        do {
            let borrower = sessionBorrower ?? UUID()
            try NativeLiveAudioSessionCoordinator.shared.acquire(borrower)
            sessionBorrower = borrower
        } catch {
            stopPlaybackSession()
            self.error = "Could not play audio. Try again."; phase = .failed; return
        }
        #endif
        guard player.play() else {
            stopPlaybackSession()
            error = "Could not play audio. Try again."; phase = .failed; return
        }
        phase = .playing
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.sampleProgress() }
        }
    }

    private func sampleProgress() {
        if let player { currentTime = min(duration, max(0, player.currentTime)) }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let identity = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, let current = self.player, ObjectIdentifier(current) == identity else { return }
            self.stopPlaybackSession()
            if flag { self.currentTime = self.duration; self.phase = .ready }
            else { self.error = "Could not play audio. Try again."; self.phase = .failed }
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        audioPlayerDidFinishPlaying(player, successfully: false)
    }

    func deactivate() {
        generation += 1
        stopPlaybackSession(); player?.delegate = nil; player = nil; verifiedData = nil
        currentTime = 0; duration = 0; error = nil; phase = .idle
    }

    private func stopTimer() { timer?.invalidate(); timer = nil }
    private func stopPlaybackSession() {
        stopTimer(); player?.stop()
        #if os(iOS)
        if let borrower = sessionBorrower {
            sessionBorrower = nil
            NativeLiveAudioSessionCoordinator.shared.release(borrower)
        }
        #endif
    }

    deinit {
        timer?.invalidate(); player?.stop()
        #if os(iOS)
        if let borrower = sessionBorrower {
            Task { @MainActor in NativeLiveAudioSessionCoordinator.shared.release(borrower) }
        }
        #endif
    }
}
