import Foundation

enum NativeLiveJSONValue: Equatable {
    case string(String), number(Double)
    var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
    }
    var numberValue: Double? {
        if case .number(let value) = self { return value }
        return nil
    }
}
struct NativeLiveRuntimeEventSnapshot {
    struct Event {
        let type: String
        let payload: [String: NativeLiveJSONValue]?
    }
    let sequence: Int
    let event: Event
    let createdAt: String
}
@main struct UserVisibleThinkingCheck {
    static func main() {
        func event(_ sequence: Int, _ kind: String, _ text: String,
                   uuid: String? = "assistant-one", type: String = "runtime") -> NativeLiveRuntimeEventSnapshot {
            var fields: [String: NativeLiveJSONValue] = [
                "kind": .string(kind), "text": .string(text),
                "content_index": .number(0)
            ]
            if let uuid { fields["source_uuid"] = .string(uuid) }
            return .init(sequence: sequence, event: .init(type: type, payload: fields),
                         createdAt: "2026-10-11T14:00:00Z")
        }
        let valid = event(2, "user_visible_thinking", "First public thought.")
        let duplicate = event(3, "user_visible_thinking", "First public thought.")
        let unrelated = event(4, "provider_observability", "Debug data.")
        let textEvent = event(5, "user_visible_thinking", "Answer body.", type: "text")
        let mixed = NativeLiveVisibleThinkingProjector.project(eventSources: [
            [duplicate, unrelated, textEvent], [valid]
        ])
        assert(mixed.count == 1, "same provider identity must appear only once")
        assert(mixed[0].text == "First public thought.")
        let swapped = NativeLiveVisibleThinkingProjector.project(eventSources: [
            [unrelated, textEvent], [valid]
        ])
        assert(swapped == mixed, "unrelated events must be excluded")
        let retained = NativeLiveVisibleThinkingProjector.project(eventSources: [[]], previous: mixed)
        assert(retained == mixed, "keep displayed content while canonical activity changes")
        let newValue = event(6, "user_visible_thinking", "Next public thought.", uuid: "assistant-two")
        let after = NativeLiveVisibleThinkingProjector.project(eventSources: [[newValue]], previous: mixed)
        assert(after.count == 2 && after[0].text == "Next public thought.", "new observations precede retained ones")
        let empty = event(7, "user_visible_thinking", "\n   ", uuid: "assistant-empty")
        assert(NativeLiveVisibleThinkingProjector.project(eventSources: [[empty]]).isEmpty)
        let many = (0..<20).map { event($0, "user_visible_thinking", "part \($0)", uuid: "assistant-\($0)") }
        assert(NativeLiveVisibleThinkingProjector.project(eventSources: [many]).count == 12)
        let noUUID = event(1, "user_visible_thinking", "Fallback identity", uuid: nil)
        assert(NativeLiveVisibleThinkingProjector.project(eventSources: [[noUUID, noUUID]]).count == 1)
        print("User-visible thinking projection PASS")
    }
}
