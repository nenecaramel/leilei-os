import AVFoundation
import Combine
import Speech

enum VoiceInputLanguage: String, CaseIterable, Identifiable, Sendable {
    case english = "en-US"
    case chinese = "zh-CN"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .english: return "English"
        case .chinese: return "中文"
        }
    }

    var locale: Locale {
        Locale(identifier: rawValue)
    }
}

/// Keeps audio in memory and requires on-device recognition; only text leaves this controller.
@MainActor
final class VoiceInputController: ObservableObject {
    enum Phase { case idle, authorizing, recording, finishing }
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var errorMessage: String?
    var isActive: Bool { phase != .idle }
    var status: String? {
        switch phase {
        case .idle: return errorMessage
        case .authorizing: return "Allow microphone and speech recognition"
        case .recording: return "Listening… release to send"
        case .finishing: return "Finishing transcription…"
        }
    }

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var deadline: Task<Void, Never>?
    private var generation = UUID()
    private var transcript = ""
    private var tapInstalled = false
    private var ownsAudioSession = false
    private var previousAudioSession: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?
    private var completion: ((String) -> Void)?

    func begin(
        language: VoiceInputLanguage = .english,
        onTranscript: @escaping (String) -> Void
    ) {
        guard !isActive else { return }
        errorMessage = nil
        phase = .authorizing
        generation = UUID()
        let token = generation
        completion = onTranscript
        Task {
            let speech = await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { status in
                    continuation.resume(returning: status == .authorized)
                }
            }
            guard generation == token else { return }
            guard speech else {
                fail("Speech recognition permission is required.")
                return
            }
            let microphone = await AVAudioApplication.requestRecordPermission()
            guard generation == token else { return }
            guard microphone else {
                fail("Microphone permission is required.")
                return
            }
            startRecognition(token: token, language: language)
        }
    }

    func release() {
        guard phase == .recording else {
            if phase == .authorizing { cancel() }
            return
        }
        phase = .finishing
        stopAudio()
        request?.endAudio()
        let token = generation
        deadline = Task {
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled, generation == token else { return }
            fail("Speech recognition did not finish. Please try again.")
        }
    }

    func cancel() {
        guard phase != .idle
                || deadline != nil
                || recognitionTask != nil
                || request != nil
                || tapInstalled
                || ownsAudioSession
                || completion != nil
                || !transcript.isEmpty else {
            return
        }

        generation = UUID()
        deadline?.cancel()
        deadline = nil
        stopAudio()
        request?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        request = nil
        completion = nil
        transcript = ""
        phase = .idle
    }

    func dismissStatusMessage() {
        guard phase == .idle else { return }
        errorMessage = nil
    }

    func reportSendFailure() {
        errorMessage = "Voice message could not be sent. Please try again."
    }

    private func startRecognition(
        token: UUID,
        language: VoiceInputLanguage
    ) {
        guard let recognizer = SFSpeechRecognizer(locale: language.locale),
              recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
            fail("On-device speech recognition is unavailable for this language.")
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            previousAudioSession = (session.category, session.mode, session.categoryOptions)
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true)
            ownsAudioSession = true
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.requiresOnDeviceRecognition = true
            request.shouldReportPartialResults = true
            self.request = request
            transcript = ""
            recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                let text = result?.bestTranscription.formattedString
                let final = result?.isFinal ?? false
                let failed = error != nil
                Task { @MainActor [weak self] in
                    guard let self, self.generation == token else { return }
                    if failed {
                        self.fail("Speech recognition failed. Please try again.")
                        return
                    }
                    if let text { self.transcript = text }
                    if final {
                        if self.phase == .finishing { self.finish() }
                        else { self.fail("Speech recognition ended before release. Please try again.") }
                    }
                }
            }
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                fail("Microphone is unavailable.")
                return
            }
            let tapBufferSize = AVAudioFrameCount(max(1, Int((format.sampleRate * 0.1).rounded(.up))))
            try input.installAudioTap(onBus: 0, bufferSize: tapBufferSize, format: format) { [weak self] buffer, _ in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == token, let request = self.request else { return }
                    request.append(AVAudioPCMBuffer(copying: buffer))
                }
            }
            tapInstalled = true
            engine.prepare()
            try engine.start()
            phase = .recording
        } catch {
            fail("Microphone could not start. Please try again.")
        }
    }

    private func stopAudio() {
        engine.stop()
        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        if ownsAudioSession {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            ownsAudioSession = false
        }
        if let previousAudioSession {
            try? AVAudioSession.sharedInstance().setCategory(
                previousAudioSession.0, mode: previousAudioSession.1, options: previousAudioSession.2
            )
            self.previousAudioSession = nil
        }
    }

    private func finish() {
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        let callback = completion
        cancel()
        guard !text.isEmpty else { return }
        callback?(text)
    }

    private func fail(_ message: String) {
        cancel()
        errorMessage = message
    }
}
