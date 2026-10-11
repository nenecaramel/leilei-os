import Foundation

// Only display the explicitly surfaced top-level Claude Code thinking text.
// This is read from already-authorized runtime events, never parsed out of
// arbitrary tool output or inferred from token counts.
struct NativeLiveVisibleThinkingItem: Identifiable, Equatable {
    let id: String
    let text: String
}

enum NativeLiveVisibleThinkingProjector {
    static func project(
        eventSources: [[NativeLiveRuntimeEventSnapshot]],
        previous: [NativeLiveVisibleThinkingItem] = []
    ) -> [NativeLiveVisibleThinkingItem] {
        var seen = Set<String>()
        var result: [NativeLiveVisibleThinkingItem] = []
        let events = eventSources.flatMap { $0 }.sorted {
            if $0.createdAt != $1.createdAt { return $0.createdAt < $1.createdAt }
            return $0.sequence < $1.sequence
        }
        for entry in events {
            guard entry.event.type == "runtime",
                  let fields = entry.event.payload,
                  fields["kind"]?.stringValue == "user_visible_thinking",
                  let text = fields["text"]?.stringValue,
                  !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
            let index = fields["content_index"]?.numberValue.flatMap { value -> Int? in
                guard value.isFinite, value >= 0, value < 1024, value.rounded() == value else { return nil }
                return Int(value)
            } ?? 0
            let source = fields["source_uuid"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
            let id = source.map { "\($0):\(index)" } ?? "thinking:\(fingerprint(text))"
            if seen.insert(id).inserted {
                result.append(.init(id: id, text: String(text.prefix(8_000))))
                if result.count == 12 { break }
            }
        }
        // Preserve already rendered sections while the overlay transitions
        // from runtime events to canonical message activity.
        for item in previous where result.count < 12 {
            if seen.insert(item.id).inserted { result.append(item) }
        }
        return result
    }

    private static func fingerprint(_ text: String) -> String {
        let hash = text.utf8.reduce(UInt64(14_695_981_039_346_656_037)) {
            ($0 ^ UInt64($1)) &* 1_099_511_628_211
        }
        return String(hash, radix: 16)
    }
}

