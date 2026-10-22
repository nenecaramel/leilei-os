import SwiftUI

// Sizes one voice/audio bubble from the width its row offers, so the longest
// bubble lines up with the theme's longest ordinary message (Original 48pt,
// iMessage 70pt clearance). An unbounded proposal uses the fallback cap, or the
// subview's natural width when there is none.
struct NativeLiveVoiceBubbleWidthLayout: Layout {
    let alignment: HorizontalAlignment
    let fallbackMaximum: CGFloat?
    let width: (CGFloat) -> CGFloat

    private func resolvedWidth(_ proposal: ProposedViewSize, subviews: Subviews) -> CGFloat {
        if let offered = proposal.width, offered.isFinite, offered > 0 { return width(offered) }
        if let fallbackMaximum { return width(fallbackMaximum) }
        return subviews.map { $0.sizeThatFits(.unspecified).width }.max() ?? 0
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let resolved = resolvedWidth(proposal, subviews: subviews)
        let height = subviews.map { $0.sizeThatFits(ProposedViewSize(width: resolved, height: proposal.height)).height }.max() ?? 0
        return CGSize(width: resolved, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let child = ProposedViewSize(width: bounds.width, height: bounds.height)
        for subview in subviews {
            let x = alignment == .trailing ? bounds.maxX - subview.sizeThatFits(child).width : bounds.minX
            subview.place(at: CGPoint(x: x, y: bounds.minY), anchor: .topLeading, proposal: child)
        }
    }
}

extension View {
    func nativeLiveVoiceBubbleWidth(alignment: HorizontalAlignment, fallbackMaximum: CGFloat?,
                                    _ width: @escaping (CGFloat) -> CGFloat) -> some View {
        NativeLiveVoiceBubbleWidthLayout(alignment: alignment, fallbackMaximum: fallbackMaximum, width: width) { self }
    }
}
