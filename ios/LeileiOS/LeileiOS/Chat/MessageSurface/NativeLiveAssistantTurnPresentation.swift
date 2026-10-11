import Foundation

struct NativeLiveAssistantTurnPresentation: Equatable, Identifiable {
    enum Phase: String { case starting, thinking, working, needsInput, background, completed, failed }
    let stableID: String
    var id: String { stableID }
    let canonicalMessageID: String?
    let prepareID: String?
    let requestID: String?
    let parentUserMessageID: String?
    let phase: Phase
    let timestamp: String?
    let bodyPresentation: NativeLiveMessagePresentation
    let activityProjection: NativeLiveTurnActivityProjection
    let duration: Int?
    let header: String
    let failure: String?
    var murmurText: String? = nil
    var visibleThinking: [NativeLiveVisibleThinkingItem] = []
    var providerMessageStartedAt: String? = nil
    var hasAuthoritativeDuration = false
    var hasCanonicalRetryTarget = true
    var stepCount: Int { activityProjection.activityCount }
    var hasPendingInput: Bool { activityProjection.hasPendingInteraction }
    var copyText: String? { bodyPresentation.copyText }
    var canCopy: Bool { copyText != nil }
    var canRetry: Bool { hasCanonicalRetryTarget && parentUserMessageID != nil && (phase == .completed || phase == .failed) }
    var backgroundState: Bool { phase == .background }
}

struct NativeLiveConversationRowPresentation: Identifiable, Equatable {
    let id: String
    let user: NativeLiveMessagePresentation?
    let userBacking: NativeLiveCurrentPathMessage?
    let assistant: NativeLiveAssistantTurnPresentation?
    var historyMessage: NativeLiveConversationHistoryMessage? = nil
    var historyTimeZone: String? = nil
    var isHistoryDivider = false
}

extension NativeLiveTurnActivityProjection {
    // Reconcile entities by provider identity, retaining durable evidence absent from an overlay.
    init(durable: Self?, overlay: Self?, active: Bool, elapsed: Int?, suppressedTools: Set<String> = [], suppressedTasks: Set<String> = [], suppressedQuestions: Set<String> = []) {
        func merge<T: Identifiable>(_ base: [T], _ fresh: [T]) -> [T] where T.ID: Hashable {
            var result = base
            for item in fresh { if let i = result.firstIndex(where: { $0.id == item.id }) { result[i] = item } else { result.append(item) } }
            return result
        }
        prepareID = overlay?.prepareID ?? durable?.prepareID
        lifecycle = overlay?.lifecycle ?? durable?.lifecycle ?? []
        tools = merge(durable?.tools ?? [],overlay?.tools ?? []).filter { !suppressedTools.contains($0.id) }.map { item in
            guard item.state == .running, let final = durable?.tools.first(where:{ $0.id == item.id && ($0.state == .completed || $0.state == .failed) }) else { return item }
            return final
        }
        tasks = merge(durable?.tasks ?? [],overlay?.tasks ?? []).filter { !suppressedTasks.contains($0.id) }.map { item in
            guard !item.isTerminal, let final = durable?.tasks.first(where:{ $0.id == item.id && $0.isTerminal }) else { return item }
            return final
        }
        interactions = merge(durable?.interactions ?? [],overlay?.interactions ?? []).filter { !suppressedQuestions.contains($0.toolUseID ?? "") }.map { item in
            guard item.isPending, let final = durable?.interactions.first(where:{ $0.id == item.id && !$0.isPending }) else { return item }
            return final
        }
        questionActivities = merge(durable?.questionActivities ?? [],overlay?.questionActivities ?? []).filter { !suppressedQuestions.contains($0.id) && !suppressedQuestions.contains($0.parentToolUseID ?? "") }.map { item in
            guard item.statusLabel == "Needs input", let final = durable?.questionActivities.first(where:{ $0.id == item.id && ["Answered","Cancelled"].contains($0.statusLabel) }) else { return item }
            return final
        }
        turnIsActive = active; turnFailed = (overlay?.turnFailed ?? false) || (durable?.turnFailed ?? false)
        elapsedSeconds = elapsed
    }
}
