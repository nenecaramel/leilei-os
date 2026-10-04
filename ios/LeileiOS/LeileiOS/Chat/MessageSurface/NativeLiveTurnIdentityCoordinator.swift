import Foundation

// Canonical IDs remain untouched. Bindings express client UI ownership only.
struct NativeLiveTurnIdentityCoordinator {
    struct Binding {
        let operationID: UUID
        let conversationID: String
        let prepareID: String
        let requestID: String
        let userMessageID: String
        let targetUserMessageID: String?
        let stableUserID: String
        let stableAssistantID: String
        let startedAt: String
    }
    private(set) var bindings: [UUID: Binding] = [:]
    func binding(prepareID: String) -> Binding? { bindings.values.first { $0.prepareID == prepareID } }
    func binding(userMessageID: String) -> Binding? { bindings.values.first { $0.userMessageID == userMessageID } }
    func userID(_ id: String) -> String { binding(userMessageID:id)?.stableUserID ?? "user:message:\(id)" }
    func assistantID(_ message: NativeLiveCurrentPathMessage) -> String {
        if let prepare = message.activity?.prepareId, let value = binding(prepareID:prepare) { return value.stableAssistantID }
        return "turn:message:\(message.id)"
    }
    func pendingIDs(_ operation: NativeLivePendingOperation, snapshot: NativeLiveCurrentPathSnapshot?) -> (user: String, assistant: String) {
        if let value = bindings[operation.id] { return (value.stableUserID,value.stableAssistantID) }
        if let target = operation.targetUserMessageID {
            let user = userID(target)
            if let assistant = snapshot?.messages.first(where: { $0.role == "assistant" && $0.parentMessageId == target }) {
                return (user,assistantID(assistant))
            }
            return (user,"turn:operation:\(operation.id)")
        }
        return ("user:operation:\(operation.id)","turn:operation:\(operation.id)")
    }
    mutating func bind(_ operation: NativeLivePendingOperation, prepared: NativeLivePrepareResult, snapshot: NativeLiveCurrentPathSnapshot?, stableIDs: (user:String,assistant:String)? = nil) {
        let ids = stableIDs ?? pendingIDs(operation,snapshot:snapshot)
        bindings[operation.id] = .init(operationID:operation.id,conversationID:prepared.conversationId,prepareID:prepared.prepareId,
            requestID:prepared.requestId,userMessageID:prepared.userMessageId,targetUserMessageID:operation.targetUserMessageID,
            stableUserID:ids.user,stableAssistantID:ids.assistant,startedAt:operation.startedAt)
    }
}
