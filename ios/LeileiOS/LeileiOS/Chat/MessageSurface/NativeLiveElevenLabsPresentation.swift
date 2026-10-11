import Foundation

// Render-only interpretation of completed ElevenLabs tool results.
// This does not change tool ownership, messages, or attachment persistence.
struct NativeLiveElevenLabsAudioPresentation: Equatable {
    let generationID: String
    let url: URL
    let durationSeconds: TimeInterval?
    let expiresAt: Date?
}

struct NativeLiveElevenLabsResultItem: Identifiable, Equatable {
    let toolID: String
    let audio: NativeLiveElevenLabsAudioPresentation
    var id: String { audio.generationID }
}

enum NativeLiveElevenLabsResultProjector {
    static let providerTools: Set<String> = [
        "mcp__ElevenLabs__creative_get_flow_run_status",
        "mcp__claude_ai_ElevenLabs__creative_get_flow_run_status",
        "mcp__ElevenLabs__creative_show_flow_results",
        "mcp__claude_ai_ElevenLabs__creative_show_flow_results",
        "mcp__ElevenLabs__creative_generate_speech",
        "mcp__claude_ai_ElevenLabs__creative_generate_speech",
        "mcp__ElevenLabs__creative_generate_in_flow",
        "mcp__claude_ai_ElevenLabs__creative_generate_in_flow"
    ]

    static func project(
        tools: [NativeLiveTurnActivityProjection.ToolActivity],
        now: Date = Date()
    ) -> [NativeLiveElevenLabsResultItem] {
        var seen = Set<String>()
        return tools.sorted { $0.order < $1.order }.flatMap { tool -> [NativeLiveElevenLabsResultItem] in
            guard tool.state == .completed,
                  providerTools.contains(tool.providerToolName),
                  let result = outputObject(tool.output),
                  result["all_completed"]?.boolValue == true,
                  result["has_failures"]?.boolValue != true,
                  let generations = result["generations"]?.arrayValue else { return [] }
            let media = result["media"]?.arrayValue ?? []
            var items: [NativeLiveElevenLabsResultItem] = []
            for entry in generations.prefix(12) {
                guard let generation = entry.objectValue,
                      generation["modality"]?.stringValue == "audio",
                      generation["status"]?.stringValue == "completed",
                      let id = generation["id"]?.stringValue,
                      !id.isEmpty, id.count <= 128,
                      !seen.contains(id) else { continue }
                let matchingMedia = media.first { value in
                    let candidate = value.objectValue
                    return candidate?["generation_id"]?.stringValue == id
                        && candidate?["kind"]?.stringValue == "audio"
                }?.objectValue
                guard let address = matchingMedia?["url"]?.stringValue
                        ?? generation["content_url"]?.stringValue,
                      let url = audioURL(address) else { continue }
                let expiresAt = expiry(for: url)
                if let expiresAt, expiresAt <= now { continue }
                let seconds = generation["duration_secs"]?.numberValue
                let duration = seconds.flatMap { $0.isFinite && $0 > 0 ? $0 : nil }
                seen.insert(id)
                items.append(.init(toolID: tool.id, audio: .init(
                    generationID: id, url: url, durationSeconds: duration,
                    expiresAt: expiresAt
                )))
                if items.count >= 5 { break }
            }
            return items
        }
    }

    // Reject arbitrary tool text/URLs. Only a known ElevenLabs result schema
    // may supply a playable remote audio URL.
    static func audioURL(_ address: String) -> URL? {
        guard address.count < 8192, let url = URL(string: address),
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "https",
              parts.user == nil, parts.password == nil, parts.port == nil,
              let host = parts.host?.lowercased() else { return nil }
        let path = parts.path.lowercased()
        let knownSource = (host == "storage.googleapis.com" && path.hasPrefix("/xi-backend/"))
            || host == "cdn.elevenlabs.io"
            || host == "api.elevenlabs.io"
        guard knownSource, path.hasSuffix(".mp3") else { return nil }
        return url
    }

    static func expiry(for url: URL) -> Date? {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let query = parts.queryItems,
              let dateText = query.first(where: { $0.name.lowercased() == "x-goog-date" })?.value,
              let secondsText = query.first(where: { $0.name.lowercased() == "x-goog-expires" })?.value,
              let seconds = TimeInterval(secondsText), seconds.isFinite,
              seconds > 0, seconds <= 604800 else { return nil }
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = TimeZone(secondsFromGMT: 0)
        parser.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        return parser.date(from: dateText)?.addingTimeInterval(seconds)
    }

    private static func outputObject(
        _ value: NativeLiveJSONValue?, depth: Int = 0
    ) -> [String: NativeLiveJSONValue]? {
        guard depth < 3 else { return nil }
        if let object = value?.objectValue {
            if let content = object["content"],
               let result = outputObject(content, depth: depth + 1) { return result }
            return object
        }
        let text: String
        if let raw = value?.stringValue { text = raw }
        else if let blocks = value?.arrayValue, blocks.count == 1,
                let block = blocks.first?.objectValue,
                block["type"]?.stringValue == "text",
                let raw = block["text"]?.stringValue { text = raw }
        else { return nil }
        return (try? JSONDecoder().decode(NativeLiveJSONValue.self, from: Data(text.utf8)))?.objectValue
    }
}
