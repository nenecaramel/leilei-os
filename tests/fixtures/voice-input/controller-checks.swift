@main
struct ControllerChecks {
    @MainActor static func pause(_ seconds: Double = 0.03) async {
        try? await Task.sleep(for: .seconds(seconds))
    }
    @MainActor static func main() async {
        let controller = VoiceInputController()
        var sent: [String] = []
        controller.begin { sent.append($0) }
        await pause()
        precondition(controller.phase == .recording)
        precondition(
            SFSpeechRecognizer.lastLocaleIdentifier
                == VoiceInputLanguage.english.locale.identifier,
            "default recognition language must be English"
        )
        SFSpeechRecognizer.emit("开头", final: false)
        await pause()
        controller.release()
        await pause(1.2)
        precondition(sent.isEmpty, "must not submit partial transcription after one second")
        SFSpeechRecognizer.emit("开头和最后几个字", final: true)
        await pause()
        precondition(sent == ["开头和最后几个字"])
        precondition(controller.phase == .idle)

        controller.begin(language: .chinese) { sent.append($0) }
        await pause()
        precondition(controller.phase == .recording)
        precondition(
            SFSpeechRecognizer.lastLocaleIdentifier
                == VoiceInputLanguage.chinese.locale.identifier,
            "Chinese selection must use zh-CN recognition"
        )
        controller.cancel()

        controller.begin { sent.append($0) }
        await pause()
        let stale = SFSpeechRecognizer.handler
        controller.cancel()
        controller.begin { sent.append($0) }
        await pause()
        precondition(controller.phase == .recording, "next hold after interruption must work")
        stale?(RecognitionResult(bestTranscription: Transcription(formattedString: "stale"), isFinal: true), nil)
        await pause()
        precondition(controller.phase == .recording)
        controller.release()
        SFSpeechRecognizer.emit("第二次", final: true)
        await pause()
        precondition(sent == ["开头和最后几个字", "第二次"])

        controller.begin { sent.append($0) }
        await pause()
        SFSpeechRecognizer.emit("partial", final: false)
        await pause()
        controller.release()
        await pause(5.2)
        precondition(controller.phase == .idle && controller.errorMessage != nil)
        precondition(sent.count == 2, "timeout must fail without sending partial text")

        controller.begin { sent.append($0) }
        await pause()
        controller.release()
        SFSpeechRecognizer.emit("  ", final: true)
        await pause()
        precondition(sent.count == 2)

        controller.begin { sent.append($0) }
        controller.release() // release before permissions resolve
        await pause()
        precondition(controller.phase == .idle && sent.count == 2)
        SFSpeechRecognizer.permission = .denied
        controller.begin { sent.append($0) }
        await pause()
        precondition(controller.phase == .idle && controller.errorMessage != nil && sent.count == 2)
        SFSpeechRecognizer.permission = .authorized
        AVAudioApplication.allowed = false
        controller.begin { sent.append($0) }
        await pause()
        precondition(controller.phase == .idle && controller.errorMessage != nil && sent.count == 2)
        AVAudioApplication.allowed = true
        controller.begin { sent.append($0) }
        await pause()
        SFSpeechRecognizer.handler?(nil, NSError(domain: "recognition", code: 1))
        await pause()
        precondition(controller.phase == .idle && controller.errorMessage != nil && sent.count == 2)
        controller.dismissStatusMessage()
        precondition(controller.errorMessage == nil, "idle voice status must be dismissible before opening the language menu")
        print("controller lifecycle PASS")
    }
}
