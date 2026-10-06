import Foundation
import Combine
import AVFoundation

#if os(iOS)
// Audio bubbles share one session lease: only the first acquisition changes the
// process session, and only the final release restores the original configuration.
@MainActor private final class NativeLiveAudioSessionCoordinator {
    static let shared = NativeLiveAudioSessionCoordinator()
    private struct Configuration {
        let category: AVAudioSession.Category
        let mode: AVAudioSession.Mode
        let options: AVAudioSession.CategoryOptions
    }
    private var owners: Set<UUID> = []
    private var previous: Configuration?

    func acquire(_ owner: UUID) throws {
        guard !owners.contains(owner) else { return }
        if owners.isEmpty {
            let session = AVAudioSession.sharedInstance()
            let saved = Configuration(category: session.category, mode: session.mode, options: session.categoryOptions)
            var categoryChanged = false
            do {
                try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
                categoryChanged = true
                try session.setActive(true)
            } catch {
                // A category change may succeed before activation fails. Roll it
                // back without recording an owner for the failed acquisition.
                // Activation did not succeed, so this attempt never owned the
                // session and must not deactivate somebody else's active audio.
                if categoryChanged {
                    try? session.setCategory(saved.category, mode: saved.mode, options: saved.options)
                }
                throw error
            }
            previous = saved
        }
        owners.insert(owner)
    }

    func release(_ owner: UUID) {
        guard owners.remove(owner) != nil, owners.isEmpty, let saved = previous else { return }
        previous = nil
        let session = AVAudioSession.sharedInstance()
        // Attempt restoration even if deactivation throws; neither failure may
        // leave a stale lease that suppresses the next acquisition/restoration.
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
        try? session.setCategory(saved.category, mode: saved.mode, options: saved.options)
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
    private var sessionOwner: UUID?
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
        if phase == .failed { player?.stop(); player = nil }
        if player == nil {
            let cached = verifiedData
            await prepare { if let cached { return cached }; return try await load() }
        }
        guard let player, phase == .ready || phase == .paused else { return }
        if currentTime >= duration { player.currentTime = 0; currentTime = 0 }
        #if os(iOS)
        do {
            let owner = sessionOwner ?? UUID()
            try NativeLiveAudioSessionCoordinator.shared.acquire(owner)
            sessionOwner = owner
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
        if let owner = sessionOwner {
            sessionOwner = nil
            NativeLiveAudioSessionCoordinator.shared.release(owner)
        }
        #endif
    }

    deinit {
        timer?.invalidate(); player?.stop()
        #if os(iOS)
        if let owner = sessionOwner {
            Task { @MainActor in NativeLiveAudioSessionCoordinator.shared.release(owner) }
        }
        #endif
    }
}
