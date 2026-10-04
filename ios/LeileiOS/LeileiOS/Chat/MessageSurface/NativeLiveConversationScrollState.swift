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
    func preservedAnchor(before: Anchor?, survivingIDs: Set<String>, replacementID: String? = nil) -> Anchor? {
        guard let before,before.relativeOffset.isFinite else { return nil }
        if survivingIDs.contains(before.stableID) { return before }
        guard let replacementID,survivingIDs.contains(replacementID) else { return nil }
        return .init(stableID:replacementID,relativeOffset:before.relativeOffset)
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
