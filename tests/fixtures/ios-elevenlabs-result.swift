import Foundation

// Linux/macOS standalone witnesses for the real Foundation-only projector.
enum NativeLiveJSONValue: Codable, Equatable {
    case object([String: Self]), array([Self]), string(String), number(Double), bool(Bool), null
    var objectValue: [String: Self]? { if case .object(let value) = self { return value }; return nil }
    var arrayValue: [Self]? { if case .array(let value) = self { return value }; return nil }
    var stringValue: String? { if case .string(let value) = self { return value }; return nil }
    var numberValue: Double? { if case .number(let value) = self { return value }; return nil }
    var boolValue: Bool? { if case .bool(let value) = self { return value }; return nil }
    init(from decoder: Decoder) throws {
        let box = try decoder.singleValueContainer()
        if box.decodeNil() { self = .null }
        else if let value = try? box.decode(Bool.self) { self = .bool(value) }
        else if let value = try? box.decode(Double.self) { self = .number(value) }
        else if let value = try? box.decode(String.self) { self = .string(value) }
        else if let value = try? box.decode([Self].self) { self = .array(value) }
        else { self = .object(try box.decode([String: Self].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var box = encoder.singleValueContainer()
        switch self {
        case .object(let value): try box.encode(value)
        case .array(let value): try box.encode(value)
        case .string(let value): try box.encode(value)
        case .number(let value): try box.encode(value)
        case .bool(let value): try box.encode(value)
        case .null: try box.encodeNil()
        }
    }
}

struct NativeLiveTurnActivityProjection {
    struct ToolActivity {
        let id: String
        let providerToolName: String
        let output: NativeLiveJSONValue?
        let state: State
        let order: Int
        enum State { case running, completed, failed }
    }
}

@main struct ElevenLabsProjectionCheck {
    static func main() throws {
        typealias Tool = NativeLiveTurnActivityProjection.ToolActivity
        let url = "https://storage.googleapis.com/xi-backend/database/workspace/example/content_generation/g-01/content.mp3?X-Goog-Date=20261011T120000Z&X-Goog-Expires=7200&X-Goog-Signature=test"
        let finished: [String: Any] = [
            "all_completed": true, "has_failures": false,
            "generations": [
                ["id": "g-01", "modality": "audio", "status": "completed", "duration_secs": 7.84, "content_url": url],
                ["id": "g-video", "modality": "video", "status": "completed", "content_url": url]
            ],
            "media": [["generation_id": "g-01", "kind": "audio", "url": url]]
        ]
        func output(_ object: [String: Any]) throws -> NativeLiveJSONValue {
            let data = try JSONSerialization.data(withJSONObject: object)
            return .array([.object(["type": .string("text"), "text": .string(String(decoding: data, as: UTF8.self))])])
        }
        func tool(_ name: String, _ payload: NativeLiveJSONValue, _ state: Tool.State = .completed, _ id: String = "t1") -> Tool {
            Tool(id: id, providerToolName: name, output: payload, state: state, order: id == "t1" ? 1 : 2)
        }
        let status = "mcp__claude_ai_ElevenLabs__creative_get_flow_run_status"
        let audio = try output(finished)
        let now = ISO8601DateFormatter().date(from: "2026-10-11T12:30:00Z")!
        let result = NativeLiveElevenLabsResultProjector.project(tools: [tool(status, audio)], now: now)
        assert(result.count == 1, "one completed audio generation")
        assert(result[0].audio.generationID == "g-01")
        assert(result[0].audio.durationSeconds == 7.84)
        assert(result[0].audio.expiresAt != nil)
        assert(NativeLiveElevenLabsResultProjector.project(
            tools: [tool(status, audio), tool(status, audio, .completed, "t2")], now: now
        ).count == 1, "duplicate polling must render only once")
        assert(NativeLiveElevenLabsResultProjector.project(
            tools: [tool(status, audio, .running)], now: now
        ).isEmpty, "unfinished tool does not display")
        assert(NativeLiveElevenLabsResultProjector.project(
            tools: [tool("mcp__Other__creative_get_flow_run_status", audio)], now: now
        ).isEmpty, "provider identity must be exact")
        assert(NativeLiveElevenLabsResultProjector.project(
            tools: [tool(status, audio)], now: ISO8601DateFormatter().date(from: "2026-10-11T15:00:00Z")!
        ).isEmpty, "expired signed audio disappears")
        var incomplete = finished
        incomplete["all_completed"] = false
        let incompleteOutput = try output(incomplete)
        assert(NativeLiveElevenLabsResultProjector.project(
            tools: [tool(status, incompleteOutput)], now: now
        ).isEmpty, "starting generation is not a playable result")
        var bad = finished
        bad["generations"] = [["id": "g-01", "modality": "audio", "status": "completed", "duration_secs": 7.84,
                               "content_url": "https://untrusted.example/content.mp3"]]
        bad["media"] = []
        let badOutput = try output(bad)
        assert(NativeLiveElevenLabsResultProjector.project(
            tools: [tool(status, badOutput)], now: now
        ).isEmpty, "unknown audio hosts are rejected")
        assert(NativeLiveElevenLabsResultProjector.audioURL("http://storage.googleapis.com/xi-backend/x.mp3") == nil)
        assert(NativeLiveElevenLabsResultProjector.audioURL("https://storage.googleapis.com/other/x.mp3") == nil)
        print("ElevenLabs projection PASS")
    }
}
