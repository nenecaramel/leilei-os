import Foundation

// Display decisions only. Recomputed from each event/canonical presentation;
// no execution phase, timer, message ownership or counting is changed here.
struct NativeLiveProcessSections: Equatable {
    let showsLoading: Bool
    let showsThinking: Bool
    let showsActivity: Bool

    init(isActive: Bool, hasBody: Bool, hasThinking: Bool, stepCount: Int,
         needsInput: Bool, hasFailure: Bool, hasBackgroundTask: Bool) {
        showsThinking = hasThinking
        showsActivity = stepCount > 0 || needsInput || hasFailure || hasBackgroundTask
        showsLoading = isActive && !hasBody && !hasThinking && !showsActivity
    }
}
