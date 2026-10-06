import Foundation

struct NativeLiveSpotifyEntityPresentation: Equatable {
    let name: String
    let uri: String?
    let url: URL?
    let creator: String?
    let typeLabel: String?
    let parent: String?
    let description: String?
    let coverURL: URL?
    // Preserve optional provider fields without assigning playback/library semantics.
    let metadata: [String: NativeLiveJSONValue]
}

struct NativeLiveSpotifyResultPresentation: Equatable {
    var entities: [NativeLiveSpotifyEntityPresentation] = []
    var isEmpty = false
    var errorTitle: String?
    var errorMessage: String?
    var errorCode: String?
}

// Pure presentation only. Neither tool identity nor durable projection is rewritten.
enum NativeLiveSpotifyProjector {
    static let allowedProviderTools: Set<String> = [
        "mcp__Spotify__search",
        "mcp__Spotify__generate_playlist",
        "mcp__Spotify__get_currently_playing",
        "mcp__claude_ai_Spotify__search",
        "mcp__claude_ai_Spotify__generate_playlist",
        "mcp__claude_ai_Spotify__get_currently_playing"
    ]
    private static let currentlyPlayingProviderTools: Set<String> = [
        "mcp__Spotify__get_currently_playing",
        "mcp__claude_ai_Spotify__get_currently_playing"
    ]

    static func project(providerToolName: String, output: NativeLiveJSONValue?) -> NativeLiveSpotifyResultPresentation? {
        guard allowedProviderTools.contains(providerToolName), let object = outputObject(output) else { return nil }
        if object["is_error"]?.boolValue == true {
            let error = object["error"]?.objectValue
            let title = text(error?["title"])
            let message = text(error?["message"]) ?? text(object["error_message"])
            let code = text(error?["error_code"])
            guard title != nil || message != nil || code != nil else { return nil }
            return .init(errorTitle: title, errorMessage: message, errorCode: code)
        }
        if object["is_error"] != nil && object["is_error"]?.boolValue == nil { return nil }
        if currentlyPlayingProviderTools.contains(providerToolName) {
            guard let value = object["currently_playing_entity"] else { return nil }
            if value == .null { return .init(isEmpty: true) }
            guard let entity = entity(value) else { return nil }
            return .init(entities: [entity])
        }
        guard let values = object["entities"]?.arrayValue, !values.isEmpty else { return nil }
        var entities: [NativeLiveSpotifyEntityPresentation] = []
        for value in values {
            guard let parsed = entity(value) else { return nil }
            if entities.count < 5 { entities.append(parsed) }
        }
        return .init(entities: entities)
    }

    private static func outputObject(_ value: NativeLiveJSONValue?) -> [String: NativeLiveJSONValue]? {
        if let object = value?.objectValue { return object }
        let text: String
        if let string = value?.stringValue { text = string }
        else if let blocks = value?.arrayValue, blocks.count == 1,
                let block = blocks.first?.objectValue, block["type"]?.stringValue == "text",
                let string = block["text"]?.stringValue { text = string }
        else { return nil }
        // The existing SDK normalizer preserves tool_result.content as either
        // JSON text or a single MCP text block. Unwrap only that known envelope;
        // the decoded value must still pass the provider-specific schema below.
        return (try? JSONDecoder().decode(NativeLiveJSONValue.self, from: Data(text.utf8)))?.objectValue
    }

    private static func entity(_ value: NativeLiveJSONValue) -> NativeLiveSpotifyEntityPresentation? {
        guard let object = value.objectValue, let name = text(object["name"]) else { return nil }
        let url = webURL(object["url"])
        let uri = text(object["uri"]).flatMap { value -> String? in
            let parts = value.split(separator: ":", omittingEmptySubsequences: false)
            return parts.count >= 3 && parts[0] == "spotify" && parts.dropFirst().allSatisfy({ !$0.isEmpty })
                && !value.contains(where: { $0.isWhitespace }) ? value : nil
        }
        guard url != nil || uri != nil else { return nil }
        let display = object["display"]?.objectValue
        let creators = object["creators"]?.arrayValue?.compactMap { text($0.objectValue?["name"]) ?? text($0) }
        let coverObjects = display?["covers"]?.arrayValue?.compactMap(\.objectValue) ?? []
        let covers = coverObjects.sorted { coverPriority($0) < coverPriority($1) }
        return .init(name: name, uri: uri, url: url,
                     creator: creators?.isEmpty == false ? creators?.joined(separator: ", ") : nil,
                     typeLabel: text(display?["type_label"]) ?? text(object["entity_type"]),
                     parent: text(object["parent"]?.objectValue?["name"]),
                     description: text(display?["description"]),
                     coverURL: covers.compactMap { webURL($0["url"]) }.first,
                     metadata: object)
    }

    private static func coverPriority(_ object: [String: NativeLiveJSONValue]) -> Int {
        switch text(object["size"] ?? object["type"])?.uppercased() {
        case "DEFAULT": return 0
        case "LARGE": return 1
        case "SMALL": return 2
        default: return 3
        }
    }

    private static func text(_ value: NativeLiveJSONValue?) -> String? {
        guard let raw = value?.stringValue, !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return raw
    }

    private static func webURL(_ value: NativeLiveJSONValue?) -> URL? {
        guard let string = text(value), !string.contains(where: { $0.isWhitespace }),
              let url = URL(string: string), let scheme = url.scheme?.lowercased(),
              ["https", "http"].contains(scheme), let host = url.host, !host.isEmpty,
              url.user == nil, url.password == nil else { return nil }
        return url
    }
}
