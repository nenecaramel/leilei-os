import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct FlowLayout:
    Layout {
    let spacing: CGFloat

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        let width =
            proposal.width
            ?? .greatestFiniteMagnitude
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size =
                subview.sizeThatFits(
                    .unspecified
                )

            if x > 0,
               x + size.width > width {
                x = 0
                y += lineHeight + spacing
                lineHeight = 0
            }

            x += size.width + spacing
            lineHeight = max(
                lineHeight,
                size.height
            )
        }

        return CGSize(
            width:
                proposal.width
                    ?? max(0, x - spacing),
            height: y + lineHeight
        )
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        var x = bounds.minX
        var y = bounds.minY
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size =
                subview.sizeThatFits(
                    .unspecified
                )

            if x > bounds.minX,
               x + size.width
                    > bounds.maxX {
                x = bounds.minX
                y += lineHeight + spacing
                lineHeight = 0
            }

            subview.place(
                at: CGPoint(
                    x: x,
                    y: y
                ),
                anchor: .topLeading,
                proposal:
                    ProposedViewSize(
                        width: size.width,
                        height: size.height
                    )
            )

            x += size.width + spacing
            lineHeight = max(
                lineHeight,
                size.height
            )
        }
    }
}
