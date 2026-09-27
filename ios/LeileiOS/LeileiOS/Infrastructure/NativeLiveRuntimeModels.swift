import Foundation

enum NativeLiveJSONValue: Codable, Sendable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: NativeLiveJSONValue])
    case array([NativeLiveJSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value =
            try? container.decode([String: NativeLiveJSONValue].self) {
            self = .object(value)
        } else if let value =
            try? container.decode([NativeLiveJSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.typeMismatch(
                NativeLiveJSONValue.self,
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "Unsupported JSON value."
                )
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }

    var stringValue: String? {
        guard case .string(let value) = self else {
            return nil
        }
        return value
    }

    var boolValue: Bool? {
        guard case .bool(let value) = self else {
            return nil
        }
        return value
    }

    var numberValue: Double? {
        guard case .number(let value) = self else {
            return nil
        }
        return value
    }

    var objectValue: [String: NativeLiveJSONValue]? {
        guard case .object(let value) = self else {
            return nil
        }
        return value
    }

    var arrayValue: [NativeLiveJSONValue]? {
        guard case .array(let value) = self else {
            return nil
        }
        return value
    }
}

struct NativeLiveRuntimeEventSnapshot:
    Decodable,
    Sendable,
    Equatable,
    Identifiable {
    struct Event: Decodable, Sendable, Equatable {
        let type: String
        let providerSessionID: String?
        let payload: [String: NativeLiveJSONValue]?

        enum CodingKeys: String, CodingKey {
            case type
            case providerSessionID = "provider_session_id"
            case payload
        }
    }

    let sequence: Int
    let event: Event
    let createdAt: String

    var id: Int { sequence }
}

struct NativeLiveRuntimeEventPage: Sendable, Equatable {
    let prepareID: String
    let events: [NativeLiveRuntimeEventSnapshot]
    let nextAfterSequence: Int
}

struct NativeLiveRuntimeInteractionSnapshot:
    Decodable,
    Sendable,
    Equatable,
    Identifiable {
    let interactionID: String
    let prepareID: String
    let kind: String
    let request: [String: NativeLiveJSONValue]
    let status: String
    let response: [String: NativeLiveJSONValue]?
    let createdAt: String
    let updatedAt: String
    let resolvedAt: String?
    let cancelledAt: String?

    var id: String { interactionID }

    enum CodingKeys: String, CodingKey {
        case interactionID = "interactionId"
        case prepareID = "prepareId"
        case kind
        case request
        case status
        case response
        case createdAt
        case updatedAt
        case resolvedAt
        case cancelledAt
    }
}

struct NativeLiveRuntimeControlSnapshot:
    Decodable,
    Sendable,
    Equatable,
    Identifiable {
    let controlID: String
    let prepareID: String
    let kind: String
    let payload: [String: NativeLiveJSONValue]
    let status: String
    let reservedBy: String?
    let receipt: [String: NativeLiveJSONValue]?
    let failureCode: String?
    let createdAt: String
    let updatedAt: String
    let appliedAt: String?

    var id: String { controlID }

    enum CodingKeys: String, CodingKey {
        case controlID = "controlId"
        case prepareID = "prepareId"
        case kind
        case payload
        case status
        case reservedBy
        case receipt
        case failureCode
        case createdAt
        case updatedAt
        case appliedAt
    }
}

struct NativeLiveRuntimeQuestionOption:
    Sendable,
    Equatable,
    Identifiable {
    let label: String
    let description: String?

    var id: String { label }
}

struct NativeLiveRuntimeQuestion:
    Sendable,
    Equatable,
    Identifiable {
    let text: String
    let header: String?
    let options: [NativeLiveRuntimeQuestionOption]
    let multiSelect: Bool

    var id: String { text }
}

extension NativeLiveRuntimeInteractionSnapshot {
    var isPending: Bool {
        status == "pending"
    }

    var permissionToolName: String? {
        request["toolName"]?.stringValue
    }

    var permissionTitle: String {
        if let title = request["title"]?.stringValue,
           !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return title
        }
        if let displayName = request["displayName"]?.stringValue,
           !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return displayName
        }
        if let tool = permissionToolName {
            return "Allow \(tool)?"
        }
        return "Allow this action?"
    }

    var permissionDetail: String? {
        if let description = request["description"]?.stringValue,
           !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return description
        }

        guard let input = request["input"]?.objectValue else {
            return nil
        }

        for key in ["command", "file_path", "path", "url", "query"] {
            if let value = input[key]?.stringValue,
               !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return value
            }
        }

        if let blockedPath = request["blockedPath"]?.stringValue,
           !blockedPath.isEmpty {
            return blockedPath
        }

        return nil
    }

    var questions: [NativeLiveRuntimeQuestion] {
        guard kind == "question",
              let values = request["questions"]?.arrayValue else {
            return []
        }

        return values.compactMap { value in
            guard let object = value.objectValue,
                  let text = trimmedString(
                      object["question"]
                  ) else {
                return nil
            }

            let options =
                object["options"]?.arrayValue?
                    .compactMap {
                        optionValue
                            -> NativeLiveRuntimeQuestionOption? in
                        guard let option = optionValue.objectValue,
                              let label = trimmedString(
                                  option["label"]
                              ) else {
                            return nil
                        }

                        return NativeLiveRuntimeQuestionOption(
                            label: label,
                            description: trimmedString(
                                option["description"]
                            )
                        )
                    } ?? []

            return NativeLiveRuntimeQuestion(
                text: text,
                header: trimmedString(
                    object["header"]
                ),
                options: options,
                multiSelect:
                    object["multiSelect"]?.boolValue == true
            )
        }
    }

    private func trimmedString(
        _ value: NativeLiveJSONValue?
    ) -> String? {
        guard let raw = value?.stringValue else {
            return nil
        }

        let trimmed = raw.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return trimmed.isEmpty ? nil : trimmed
    }

}

struct NativeLiveRuntimeSurfaceState:
    Sendable,
    Equatable {
    let prepareID: String
    let conversationID: UUID
    var events: [NativeLiveRuntimeEventSnapshot]
    var interactions: [NativeLiveRuntimeInteractionSnapshot]
    var controls: [NativeLiveRuntimeControlSnapshot]
    var nextAfterSequence: Int

    var streamingText: String {
        let deltas = events.compactMap { event -> String? in
            guard event.event.type == "partial_text" else {
                return nil
            }
            return event.event.payload?["delta"]?.stringValue
        }

        if !deltas.isEmpty {
            return deltas.joined()
        }

        return events.compactMap { event -> String? in
            guard event.event.type == "text" else {
                return nil
            }
            return event.event.payload?["text"]?.stringValue
        }
        .joined(separator: "\n\n")
    }

    var activityText: String? {
        for event in events.reversed() {
            let payload = event.event.payload ?? [:]

            switch event.event.type {
            case "partial_text", "text", "result", "error":
                return nil

            case "task":
                let phase = payload["phase"]?.stringValue
                let summary =
                    payload["summary"]?.stringValue
                    ?? payload["description"]?.stringValue
                let tool = payload["last_tool_name"]?.stringValue

                if phase == "updated",
                   let patch = payload["patch"]?.objectValue,
                   let status = patch["status"]?.stringValue,
                   ["completed", "failed", "cancelled"].contains(status) {
                    return nil
                }

                if phase == "notification",
                   let status = payload["status"]?.stringValue,
                   ["completed", "failed", "cancelled"].contains(status) {
                    return nil
                }

                if phase == "active_set",
                   let tasks = payload["tasks"]?.arrayValue {
                    if tasks.isEmpty {
                        return nil
                    }
                    return tasks.count == 1
                        ? "1 task active"
                        : "\(tasks.count) tasks active"
                }

                if let summary, !summary.isEmpty {
                    return summary
                }
                if let tool, !tool.isEmpty {
                    return "Using \(tool)"
                }
                if phase == "started" {
                    return "Working on a task"
                }
                if phase == "progress" {
                    return "Task in progress"
                }
                return "Task updated"

            case "tool_use":
                if let tool = payload["tool_name"]?.stringValue,
                   !tool.isEmpty {
                    return "Using \(tool)"
                }
                return "Using a tool"

            case "tool_result":
                if payload["is_error"]?.boolValue == true {
                    return "Tool failed"
                }
                return "Tool finished"

            default:
                continue
            }
        }

        return nil
    }

    var hasVisibleRuntimeContent: Bool {
        !streamingText
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty
            || activityText != nil
    }
}
