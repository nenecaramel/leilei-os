import SwiftUI

/// Names the current Chat paint/layout geometry, not global app gutters.
/// These values do not add hit targets; gestures/content shapes stay at their
/// existing call sites. Keyboard and scroll ownership are intentionally unchanged.
enum ChatPresentationLayout {
    static let messageGutter: CGFloat = 16
    static let turnSpacing: CGFloat = 25
    static let messageVerticalInset: CGFloat = 8
    static let userLeadingClearance: CGFloat = 48
    static let iMessageUserLeadingClearance: CGFloat = 70
    static let iMessageUserBubbleVerticalInset: CGFloat = 10
    static let iMessageUserBubbleRadius: CGFloat = 20
    // iMessage-only layout; Original theme keeps its existing spacing constants.
    static let iMessageTurnSpacing: CGFloat = 12
    static let iMessageTextBubbleSpacing: CGFloat = 8
    static let iMessageProcessSectionSpacing: CGFloat = 10
    static let bubbleHorizontalInset: CGFloat = 14
    static let bubbleVerticalInset: CGFloat = 12
    static let bubbleRadius: CGFloat = 18
    static let processSectionSpacing: CGFloat = 18
    static let assistantSpacing: CGFloat = 6
    static let actionSpacing: CGFloat = 10
    static let actionDiameter: CGFloat = 22
    static let actionTopInset: CGFloat = 7
    static let scrollActionDiameter: CGFloat = 38
    static let scrollActionPaintOffset: CGFloat = 22

    static let composerOuterHorizontal: CGFloat = 12
    static let composerOuterTop: CGFloat = 18
    static let composerOuterBottom: CGFloat = 10
    static let composerHiddenKeyboardPaintOffset: CGFloat = 10
    static let composerHorizontalInset: CGFloat = 16
    static let composerTopInset: CGFloat = 15
    static let composerBottomInset: CGFloat = 12
    static let composerSectionSpacing: CGFloat = 14
    static let composerRowSpacing: CGFloat = 8
}
