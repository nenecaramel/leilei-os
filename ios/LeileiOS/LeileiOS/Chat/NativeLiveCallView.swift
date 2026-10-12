import SwiftUI
import Combine
import AVFoundation
import Speech

/// An opt-in, foreground conversation surface for the existing Native Live path.
/// No separate Claude session, transcript store, or model client is created.
struct NativeLiveCallView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss
    @StateObject private var call = NativeLiveCallAudioController()
    @State private var language: VoiceInputLanguage = .chinese
    @State private var speechModel: NativeLiveCallSpeechModel = .v4Turbo

    let conversationID: UUID
    let execution: NativeLiveExecutionSelection

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 76, weight: .ultraLight))
                .foregroundStyle(.primary)
                .accessibilityHidden(true)
            Text("Claude")
                .font(.largeTitle.weight(.medium))
            Text(call.statusText)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)

            Menu {
                Picker("Voice model", selection: $speechModel) {
                    ForEach(NativeLiveCallSpeechModel.allCases) { option in
                        Text(option.displayName).tag(option)
                    }
                }
            } label: {
                Label(speechModel.displayName, systemImage: "waveform")
                    .font(.subheadline)
            }
            .disabled(call.phase == .processing)

            if !call.lastHeard.isEmpty {
                Text(call.lastHeard)
                    .font(.body)
                    .multilineTextAlignment(.center)
                    .lineLimit(4)
                    .padding(.horizontal, 28)
            }

            if case .failed(let message) = call.phase {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            Spacer()
            HStack(spacing: 30) {
                Menu {
                    ForEach(VoiceInputLanguage.allCases) { option in
                        Button(option.displayName) {
                            language = option
                            if call.canListen {
                                beginListening()
                            }
                        }
                    }
                } label: {
                    Label(language.displayName, systemImage: "globe")
                        .frame(minWidth: 90)
                }
                .disabled(call.phase == .processing)

                Button {
                    beginListening()
                } label: {
                    Image(systemName: call.phase == .speaking ? "waveform" : "mic.fill")
                        .font(.title2)
                        .frame(width: 66, height: 66)
                        .background(.thinMaterial, in: Circle())
                }
                .disabled(call.phase == .processing || call.phase == .listening)
                .accessibilityLabel("Speak or interrupt playback")

                Button {
                    call.endCall()
                    dismiss()
                } label: {
                    Image(systemName: "phone.down.fill")
                        .font(.title2)
                        .foregroundStyle(.white)
                        .frame(width: 66, height: 66)
                        .background(.red, in: Circle())
                }
                .accessibilityLabel("Hang up")
            }
            .buttonStyle(.plain)
            .padding(.bottom, 35)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .navigationTitle("Voice call")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { beginListening() }
        .onDisappear { call.endCall() }
        .onChange(of: appModel.activeNativeLiveConversationID) { _, next in
            if next != conversationID {
                call.endCall()
                dismiss()
            }
        }
    }

    private func beginListening() {
        guard appModel.isAuthenticated,
              appModel.activeNativeLiveConversationID == conversationID else {
            call.fail("The conversation is no longer available.")
            return
        }
        call.interruptPlayback()
        Task { @MainActor in
            await call.beginListening(language: language) { transcript in
                Task { @MainActor in
                    await sendUtterance(transcript)
                }
            }
        }
    }

    private func sendUtterance(_ transcript: String) async {
        guard call.phase == .processing,
              appModel.activeNativeLiveConversationID == conversationID else { return }

        let oldAssistantID = appModel.nativeLiveCurrentPath?.messages
            .last(where: { $0.role == "assistant" })?.id

        do {
            try await appModel.sendNativeLiveMessage(
                transcript,
                inputMode: .voice,
                interactionMode: "live_call",
                execution: execution
            )
            guard call.phase != .ended,
                  appModel.activeNativeLiveConversationID == conversationID else { return }

            await appModel.refreshNativeLiveCurrentPath(force: true)
            guard let messages = appModel.nativeLiveCurrentPath?.messages,
                  let lastUser = messages.last(where: { $0.role == "user" }),
                  let assistant = messages.last(where: {
                      $0.role == "assistant"
                      && $0.parentMessageId == lastUser.id
                      && $0.id != oldAssistantID
                      && $0.status == "completed"
                  }),
                  !assistant.displayText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                call.fail("Claude's spoken reply isn't available. The chat is preserved.")
                return
            }

            // TTS does not alter the canonical message. Bound audio spend per turn.
            let speechText = String(assistant.displayText.prefix(1_100))
            let body = try JSONSerialization.data(withJSONObject: [
                "text": speechText,
                "model_id": speechModel.rawValue
            ])
            let bytes = try await appModel.api.rawRequest(
                path: "/api/v1/voice/speak",
                method: "POST",
                body: body,
                contentType: "application/json"
            )
            guard call.phase != .ended,
                  appModel.activeNativeLiveConversationID == conversationID else { return }
            try call.play(bytes) {
                beginListening()
            }
        } catch {
            guard call.phase != .ended else { return }
            call.fail(error.localizedDescription)
        }
    }
}

@MainActor
final class NativeLiveCallAudioController: NSObject, ObservableObject, AVAudioPlayerDelegate {
    enum Phase: Equatable {
        case idle
        case listening
        case processing
        case speaking
        case failed(String)
        case ended
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var lastHeard = ""

    var canListen: Bool { phase != .processing && phase != .ended }
    var statusText: String {
        switch phase {
        case .idle: return "Starting the microphone…"
        case .listening: return "Listening. Speak naturally; a pause sends your words."
        case .processing: return "Claude is replying…"
        case .speaking: return "Claude is speaking. Tap the microphone to interrupt."
        case .failed: return "Call paused. Tap the microphone to retry."
        case .ended: return "Call ended"
        }
    }

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognition: SFSpeechRecognitionTask?
    private var tapInstalled = false
    private var silenceTask: Task<Void, Never>?
    private var token = UUID()
    private var transcript = ""
    private var onTranscript: ((String) -> Void)?
    private var player: AVAudioPlayer?
    private var afterPlayback: (() -> Void)?

    func beginListening(
        language: VoiceInputLanguage,
        onTranscript: @escaping (String) -> Void
    ) async {
        guard canListen else { return }
        stopCapture()
        phase = .idle
        let currentToken = UUID()
        token = currentToken
        self.onTranscript = onTranscript

        let authorized = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
        guard token == currentToken, phase != .ended else { return }
        guard authorized, await AVAudioApplication.requestRecordPermission() else {
            fail("Microphone and speech recognition permissions are required.")
            return
        }
        guard token == currentToken, phase != .ended else { return }
        guard let recognizer = SFSpeechRecognizer(locale: language.locale),
              recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
            fail("On-device recognition isn't available for this language.")
            return
        }

        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.defaultToSpeaker, .allowBluetooth]
            )
            try audioSession.setActive(true)

            let newRequest = SFSpeechAudioBufferRecognitionRequest()
            newRequest.requiresOnDeviceRecognition = true
            newRequest.shouldReportPartialResults = true
            request = newRequest
            transcript = ""
            recognition = recognizer.recognitionTask(with: newRequest) { [weak self] result, error in
                let words = result?.bestTranscription.formattedString
                let isFinal = result?.isFinal == true
                let failed = error != nil
                Task { @MainActor [weak self] in
                    guard let self, self.token == currentToken,
                          self.phase == .listening else { return }
                    if failed {
                        self.fail("Speech recognition stopped. Tap to retry.")
                        return
                    }
                    if let words, !words.isEmpty {
                        self.transcript = words
                        self.scheduleSilenceEnd(for: currentToken)
                    }
                    if isFinal, !self.transcript.isEmpty {
                        self.finishUtterance()
                    }
                }
            }
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                fail("Microphone is unavailable.")
                return
            }
            let frameCount = AVAudioFrameCount(max(1, Int((format.sampleRate * 0.1).rounded(.up))))
            try input.installAudioTap(
                onBus: 0,
                bufferSize: frameCount,
                format: format
            ) { [weak self] buffer, _ in
                Task { @MainActor [weak self] in
                    guard let self, self.token == currentToken,
                          let request = self.request else { return }
                    request.append(AVAudioPCMBuffer(copying: buffer))
                }
            }
            tapInstalled = true
            engine.prepare()
            try engine.start()
            phase = .listening
        } catch {
            fail("Unable to start audio capture.")
        }
    }

    private func scheduleSilenceEnd(for expected: UUID) {
        silenceTask?.cancel()
        silenceTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(1_500))
            guard !Task.isCancelled, token == expected,
                  phase == .listening, !transcript.isEmpty else { return }
            finishUtterance()
        }
    }

    private func finishUtterance() {
        let spoken = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        let handler = onTranscript
        stopCapture()
        guard !spoken.isEmpty else {
            phase = .idle
            return
        }
        lastHeard = spoken
        phase = .processing
        handler?(spoken)
    }

    func play(_ audio: Data, onFinished: @escaping () -> Void) throws {
        guard phase == .processing else { return }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)
        let newPlayer = try AVAudioPlayer(data: audio)
        newPlayer.delegate = self
        newPlayer.prepareToPlay()
        guard newPlayer.play() else { throw CallAudioError.playbackFailed }
        player = newPlayer
        afterPlayback = onFinished
        phase = .speaking
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            self?.finishPlayback(successfully: flag)
        }
    }

    private func finishPlayback(successfully flag: Bool) {
        guard phase == .speaking else { return }
        self.player = nil
        let next = afterPlayback
        afterPlayback = nil
        phase = .idle
        if flag { next?() }
        else { fail("Audio playback stopped.") }
    }

    func interruptPlayback() {
        guard phase == .speaking else { return }
        player?.stop()
        player = nil
        afterPlayback = nil
        phase = .idle
    }

    func fail(_ message: String) {
        guard phase != .ended else { return }
        stopCapture()
        player?.stop()
        player = nil
        afterPlayback = nil
        phase = .failed(message)
    }

    func endCall() {
        stopCapture()
        player?.stop()
        player = nil
        afterPlayback = nil
        phase = .ended
        try? AVAudioSession.sharedInstance().setActive(
            false, options: .notifyOthersOnDeactivation
        )
    }

    private func stopCapture() {
        token = UUID()
        silenceTask?.cancel()
        silenceTask = nil
        engine.stop()
        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        request?.endAudio()
        recognition?.cancel()
        recognition = nil
        request = nil
        onTranscript = nil
        transcript = ""
    }
}

private enum CallAudioError: LocalizedError {
    case playbackFailed
    var errorDescription: String? { "The speech audio could not be played." }
}

private enum NativeLiveCallSpeechModel: String, CaseIterable, Identifiable {
    case v4Turbo = "eleven_v4_turbo"
    case v4 = "eleven_v4"
    case v3 = "eleven_v3"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .v4Turbo: "V4 Turbo"
        case .v4: "V4"
        case .v3: "V3"
        }
    }
}
