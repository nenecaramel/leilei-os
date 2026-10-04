import Foundation

struct NativeLiveConversationScrollState: Equatable {
    struct Anchor: Equatable { let stableID: String; let relativeOffset: Double }
    private(set) var isNearBottom = true
    private(set) var followLatest = true
    private(set) var userIsInteracting = false
    var shouldShowReturnToBottom: Bool { !isNearBottom }
    var shouldFollowContent: Bool { followLatest && !userIsInteracting }
    mutating func geometryChanged(isNearBottom: Bool) {
        self.isNearBottom = isNearBottom
        if userIsInteracting { followLatest = isNearBottom }
    }
    mutating func interactionChanged(_ active: Bool) { userIsInteracting = active }
    mutating func returnToBottom() { followLatest = true; isNearBottom = true }
    mutating func sentNewMessage() { returnToBottom() }
    // Menus, sheets and taps do not alter follow intent; only geometry/explicit action do.
    func preservedAnchor(before: Anchor?, survivingIDs: Set<String>) -> Anchor? {
        guard let before,survivingIDs.contains(before.stableID),before.relativeOffset.isFinite else { return nil }
        return before
    }
}

enum NativeLiveConversationLoadPresentation: Equatable {
    case content, quietLoading, empty, unavailable
    static func project(hasSnapshot: Bool, hasRows: Bool, ready: Bool, failed: Bool) -> Self {
        if hasRows { return .content }
        if ready { return .empty }
        if hasSnapshot { return .content }
        if failed { return .unavailable }
        return .quietLoading
    }
}
