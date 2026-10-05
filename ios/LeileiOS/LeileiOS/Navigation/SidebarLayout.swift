import SwiftUI

/// Sidebar's existing geometry, independent of the ordinary page gutter.
/// Paint offsets intentionally preserve the main@71904b00 visual positions;
/// replacing them with insets would also change stack sizing and hit frames.
enum SidebarLayout {
    static let scrollTopInset: CGFloat = 18
    static let contentHorizontalInset: CGFloat = 22
    static let scrollBottomClearance: CGFloat = 92
    static let sectionSpacing: CGFloat = 28
    static let rowSpacing: CGFloat = 6

    static let titleTopInset: CGFloat = 18
    static let titlePaintOffset = CGSize(width: -15, height: 20)
    static let navigationPaintOffsetY: CGFloat = 9
    static let sectionsPaintOffsetY: CGFloat = 7

    static let rowHorizontalInset: CGFloat = 12
    static let rowMinimumHeight: CGFloat = 44
    static let rowTextPaintOffset = CGSize(width: -22, height: 2)
    static let sectionLabelHorizontalInset: CGFloat = 10
    static let recentLabelPaintOffset = CGSize(width: -24, height: 2)
    static let viewAllMinimumHeight: CGFloat = 36

    // Selection paint is wider than its layout row in the current design.
    // It does not own row size or hit testing.
    static let selectionLeadingInset: CGFloat = -26
    static let selectionTrailingInset: CGFloat = 3
    static let selectionPaintOffsetY: CGFloat = 2
    static let selectionRadius: CGFloat = 12

    static let floatingControlDiameter: CGFloat = 44
    static let trailingFloatingControlCenterInset: CGFloat = 52
    static let searchFallbackCenterY: CGFloat = 22
    static let footerLeadingInset: CGFloat = 16
    static let footerBottomInset: CGFloat = 16
    static let footerTrailingInset =
        trailingFloatingControlCenterInset - floatingControlDiameter / 2
}

/// The identical decoration used by navigation and recent-conversation rows.
/// Keep modifier order: negative inset expands paint before translation.
struct SidebarSelectionBackground: View {
    var body: some View {
        RoundedRectangle(cornerRadius: SidebarLayout.selectionRadius)
            .fill(.primary.opacity(0.05))
            .padding(.leading, SidebarLayout.selectionLeadingInset)
            .padding(.trailing, SidebarLayout.selectionTrailingInset)
            .offset(y: SidebarLayout.selectionPaintOffsetY)
    }
}
