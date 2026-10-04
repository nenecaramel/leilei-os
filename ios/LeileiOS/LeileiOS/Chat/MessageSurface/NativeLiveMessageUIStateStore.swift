import Foundation

struct NativeLiveMessageUIStateStore {
    enum ActivityExpansion: Equatable { case collapsed, autoExpanded, userExpanded, userCollapsed }
    struct State: Equatable {
        var activityExpansion: ActivityExpansion = .collapsed
        var voiceTranscriptExpansion = false
        var isActivityExpanded: Bool { activityExpansion == .autoExpanded || activityExpansion == .userExpanded }
        mutating func pendingInputChanged(_ pending: Bool) {
            if pending && activityExpansion == .collapsed { activityExpansion = .autoExpanded }
            else if !pending && activityExpansion == .autoExpanded { activityExpansion = .collapsed }
        }
        mutating func toggleActivity() { activityExpansion = isActivityExpanded ? .userCollapsed : .userExpanded }
    }
    private var values: [String:State] = [:]
    subscript(_ id: String) -> State {
        get { values[id] ?? State() }
        set { values[id] = newValue }
    }
    mutating func prune(retaining ids: Set<String>) { if values.count > 1000 { values = values.filter { ids.contains($0.key) } } }
}
