import Foundation
import Combine

// Hardware/OS boundaries only. The production controller below is compiled unchanged.
struct AudioBuffer {}
struct AudioFormat { let sampleRate = 48000.0; let channelCount = 1 }
final class AudioInput {
    func outputFormat(forBus: Int) -> AudioFormat { AudioFormat() }
    func installTap(onBus: Int, bufferSize: Int, format: AudioFormat, block: @escaping (AudioBuffer, Int) -> Void) {}
    func removeTap(onBus: Int) {}
}
final class AVAudioEngine {
    let inputNode = AudioInput()
    func stop() {}
    func prepare() {}
    func start() throws {}
}
final class AVAudioSession {
    struct Category: Equatable { static let record = Category() }
    struct Mode: Equatable { static let measurement = Mode() }
    struct CategoryOptions: OptionSet {
        let rawValue: Int
        static let duckOthers = Self(rawValue: 1)
    }
    struct SetActiveOptions: OptionSet {
        let rawValue: Int
        static let notifyOthersOnDeactivation = Self(rawValue: 1)
    }
    let category = Category.record
    let mode = Mode.measurement
    let categoryOptions: CategoryOptions = []
    static func sharedInstance() -> AVAudioSession { AVAudioSession() }
    func setCategory(_ category: Category, mode: Mode, options: CategoryOptions) throws {}
    func setActive(_ active: Bool, options: SetActiveOptions = []) throws {}
}
enum AVAudioApplication {
    static var allowed = true
    static func requestRecordPermission() async -> Bool { allowed }
}
final class SFSpeechAudioBufferRecognitionRequest {
    var requiresOnDeviceRecognition = false
    var shouldReportPartialResults = false
    func append(_ buffer: AudioBuffer) {}
    func endAudio() {}
}
final class SFSpeechRecognitionTask { func cancel() {} }
struct Transcription { let formattedString: String }
struct RecognitionResult { let bestTranscription: Transcription; let isFinal: Bool }
final class SFSpeechRecognizer {
    enum Authorization { case authorized, denied }
    static var permission: Authorization = .authorized
    static var handler: ((RecognitionResult?, Error?) -> Void)?
    let isAvailable = true
    let supportsOnDeviceRecognition = true
    init?(locale: Locale) {}
    static func requestAuthorization(_ completion: (Authorization) -> Void) { completion(permission) }
    func recognitionTask(with request: SFSpeechAudioBufferRecognitionRequest, resultHandler: @escaping (RecognitionResult?, Error?) -> Void) -> SFSpeechRecognitionTask {
        precondition(request.requiresOnDeviceRecognition, "audio must stay on device")
        Self.handler = resultHandler
        return SFSpeechRecognitionTask()
    }
    static func emit(_ text: String, final: Bool) {
        handler?(RecognitionResult(bestTranscription: Transcription(formattedString: text), isFinal: final), nil)
    }
}
