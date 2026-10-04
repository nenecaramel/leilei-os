import Foundation
import CryptoKit

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

enum NativeLiveComposerAttachmentKind: String, Codable, Sendable {
    case image
    case file
}

enum NativeLiveComposerAttachmentUploadState:
    Sendable,
    Equatable {
    case uploading
    case ready(String)
    case failed(String)
}

struct NativeLiveComposerAttachmentDraft:
    Identifiable,
    Sendable,
    Equatable {
    let id: UUID
    let filename: String
    let mimeType: String
    let kind: NativeLiveComposerAttachmentKind
    let data: Data?
    var presentationMetadata: [String: NativeLiveJSONValue] = [:]
    var state: NativeLiveComposerAttachmentUploadState

    init(
        id: UUID = UUID(),
        filename: String,
        mimeType: String,
        kind: NativeLiveComposerAttachmentKind,
        data: Data?,
        state: NativeLiveComposerAttachmentUploadState = .uploading
    ) {
        self.id = id
        self.filename = filename
        self.mimeType = mimeType
        self.kind = kind
        self.data = data
        if let data {
            presentationMetadata = ["size_bytes": .number(Double(data.count)),
                "sha256": .string(SHA256.hash(data:data).map { String(format:"%02x",$0) }.joined())]
        }
        self.state = state
    }

    init(
        existingAttachmentID: String,
        filename: String,
        mimeType: String,
        kind: NativeLiveComposerAttachmentKind
    ) {
        self.id = UUID()
        self.filename = filename
        self.mimeType = mimeType
        self.kind = kind
        self.data = nil
        self.state = .ready(existingAttachmentID)
    }

    var remoteAttachmentID: String? {
        guard case .ready(let value) = state else {
            return nil
        }
        return value
    }

    var isReady: Bool {
        remoteAttachmentID != nil
    }

    var isUploading: Bool {
        if case .uploading = state { return true }
        return false
    }
}

struct NativeLiveChatAttachmentSnapshot:
    Decodable,
    Sendable,
    Equatable,
    Identifiable {
    let attachmentId: String
    let filename: String
    let mimeType: String
    let sizeBytes: Int
    let sha256: String
    let kind: NativeLiveComposerAttachmentKind
    let status: String
    let boundMessageId: String?
    let createdAt: String
    let expiresAt: String

    var id: String { attachmentId }
}

struct NativeLiveAttachmentTransferSlot:
    Decodable,
    Sendable,
    Equatable {
    let url: String
    let method: String
    let headers: [String: String]
    let expiresAt: String
}

struct NativeLiveAttachmentUploadSlot:
    Decodable,
    Sendable,
    Equatable {
    let attachment: NativeLiveChatAttachmentSnapshot
    let upload: NativeLiveAttachmentTransferSlot
}

struct NativeLiveAttachmentDownloadSlot:
    Decodable,
    Sendable,
    Equatable {
    let attachment: NativeLiveChatAttachmentSnapshot
    let download: NativeLiveAttachmentTransferSlot
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

    var providerCommandUUID: String? {
        receipt?["command_uuid"]?.stringValue
    }

    var providerQueueAccepted: Bool {
        status == "applied"
            && receipt?["status"]?.stringValue == "queued"
            && providerCommandUUID == controlID
    }

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
    var toolUseID: String? {
        request["toolUseId"]?.stringValue
            ?? request["tool_use_id"]?.stringValue
    }

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
    var requestID: String? = nil
    var userMessageID: String? = nil
    var operation: String? = nil
    var startedAt: String? = nil
    var preparedUserMessage: NativeLiveCurrentPathMessage? = nil
    var replacementTargetUserMessageID: String? = nil
    var terminalFailure: String? = nil
    var foregroundTurnCompleted = false

    var visibleBackgroundTaskIDs: Set<String> {
        var active = Set<String>()
        var activeSetSequence = -1

        for event in events.reversed() {
            guard event.event.type == "task",
                  event.event.payload?["phase"]?.stringValue
                    == "active_set",
                  let tasks =
                    event.event.payload?["tasks"]?.arrayValue else {
                continue
            }

            activeSetSequence = event.sequence
            active = Set(
                tasks.compactMap { value in
                    guard let task = value.objectValue,
                          task["ambient"]?.boolValue != true else {
                        return nil
                    }
                    return task["task_id"]?.stringValue
                }
            )
            break
        }

        let terminalStatuses = Set([
            "completed",
            "failed",
            "cancelled",
            "stopped",
            "killed",
        ])

        for event in events
        where event.event.type == "task"
            && event.sequence > activeSetSequence {
            let payload = event.event.payload ?? [:]
            guard let taskID = payload["task_id"]?.stringValue,
                  payload["ambient"]?.boolValue != true else {
                continue
            }

            switch payload["phase"]?.stringValue {
            case "started":
                if payload["is_backgrounded"]?.boolValue == true {
                    active.insert(taskID)
                }

            case "updated":
                if let patch = payload["patch"]?.objectValue {
                    if let status = patch["status"]?.stringValue,
                       terminalStatuses.contains(status) {
                        active.remove(taskID)
                    } else if patch["is_backgrounded"]?.boolValue == true {
                        active.insert(taskID)
                    } else if patch["is_backgrounded"]?.boolValue == false {
                        active.remove(taskID)
                    }
                }

            case "notification":
                if let status = payload["status"]?.stringValue,
                   terminalStatuses.contains(status) {
                    active.remove(taskID)
                }

            default:
                break
            }
        }

        return active
    }

    var hasVisibleBackgroundTasks: Bool {
        !visibleBackgroundTaskIDs.isEmpty
    }

    var hasPendingRuntimeInteraction: Bool {
        interactions.contains(where: \.isPending)
    }

    var shouldRemainObservedAfterForeground: Bool {
        hasVisibleBackgroundTasks
            || hasPendingRuntimeInteraction
    }

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

    var providerSessionState: String? {
        for event in events.reversed() {
            guard event.event.type == "runtime",
                  event.event.payload?["kind"]?.stringValue
                    == "session_state_changed" else {
                continue
            }
            return event.event.payload?["state"]?.stringValue
        }
        return nil
    }

    var providerTurnActive: Bool? {
        switch providerSessionState {
        case "running", "requires_action":
            return true
        case "idle":
            return false
        default:
            return nil
        }
    }

    func commandLifecycleState(
        for commandUUID: String
    ) -> String? {
        for event in events.reversed() {
            let payload = event.event.payload ?? [:]
            guard event.event.type == "runtime",
                  payload["kind"]?.stringValue
                    == "command_lifecycle",
                  payload["command_uuid"]?.stringValue
                    == commandUUID else {
                continue
            }
            return payload["state"]?.stringValue
        }
        return nil
    }

    func hasUserMessageAttribution(
        _ uuid: String
    ) -> Bool {
        for event in events.reversed() {
            let payload = event.event.payload ?? [:]
            guard event.event.type == "runtime",
                  payload["kind"]?.stringValue
                    == "user_message_attribution" else {
                continue
            }

            if payload["user_message_uuid"]?.stringValue
                == uuid {
                return true
            }

            if let values =
                payload["user_message_uuids"]?.arrayValue,
               values.contains(where: {
                   $0.stringValue == uuid
               }) {
                return true
            }
        }
        return false
    }

    var hasVisibleRuntimeContent: Bool {
        !streamingText
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty
            || events.contains { event in
                if [
                    "tool_use",
                    "tool_result",
                    "task",
                    "error",
                ].contains(event.event.type) {
                    return true
                }

                guard event.event.type == "runtime" else {
                    return false
                }

                let payload = event.event.payload ?? [:]
                switch payload["kind"]?.stringValue {
                case "album_saved", "api_retry":
                    return true
                case "command_lifecycle":
                    return [
                        "queued",
                        "started",
                    ].contains(
                        payload["state"]?.stringValue ?? ""
                    )
                default:
                    return false
                }
            }
            || !interactions.isEmpty
    }
}
