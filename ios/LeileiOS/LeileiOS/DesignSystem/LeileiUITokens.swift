import SwiftUI

/// UI-0 names existing visual values. Adopting a role must preserve the
/// consumer's value; tokens do not set hit targets or own page behavior.
enum LeileiUI {
    enum Spacing {
        static let zero: CGFloat = 0
        static let xxs: CGFloat = 2
        static let xs: CGFloat = 4
        static let sm: CGFloat = 6
        static let md: CGFloat = 8
        static let lg: CGFloat = 12
        static let xl: CGFloat = 16
        static let xxl: CGFloat = 20
        static let xxxl: CGFloat = 24
        static let section: CGFloat = 32
    }

    enum Gutter {
        static let page: CGFloat = 16
        static let reader: CGFloat = 20
        static let canvas: CGFloat = 24
        static let composer: CGFloat = 12
    }

    /// Visual diameters only; no padding, contentShape or gesture changes.
    enum ControlGeometry {
        static let compact: CGFloat = 36
        static let standard: CGFloat = 44
        static let scrollAction: CGFloat = 38
    }

    enum Radius {
        static let small: CGFloat = 8
        static let card: CGFloat = 12
        static let interaction: CGFloat = 14
        static let bubble: CGFloat = 18
        static let composer: CGFloat = 30
    }

    enum Typography {
        static let body: Font = .body
        static let secondary: Font = .subheadline
        static let metadata: Font = .caption
        // Preserve distinct existing fixed roles; UI-0 does not merge sizes.
        static let timestamp: Font = .system(size: 13.5)
        static let compactLabel: Font = .system(size: 13, weight: .regular)
        static let compactDetail: Font = .system(size: 11.5, weight: .regular)
        static let navigationSupplement: Font = .system(size: 14.5, weight: .medium)

        static func controlGlyph(weight: Font.Weight) -> Font {
            .system(size: 15, weight: weight)
        }
    }

    enum Color {
        static var pageBackground: SwiftUI.Color {
            SwiftUI.Color(uiColor: .systemBackground)
        }
        // Dynamic roles for later adoption. Do not replace the existing
        // fixed Settings/Sidebar backgrounds until a visual-change phase.
        static var groupedBackground: SwiftUI.Color {
            SwiftUI.Color(uiColor: .systemGroupedBackground)
        }
        static var sidebarBackground: SwiftUI.Color {
            SwiftUI.Color(uiColor: .secondarySystemBackground)
        }
        static var softFill: SwiftUI.Color {
            SwiftUI.Color(uiColor: .quaternarySystemFill)
        }
        static var selectionFill: SwiftUI.Color {
            SwiftUI.Color.primary.opacity(0.05)
        }
        static var subtleBorder: SwiftUI.Color {
            SwiftUI.Color.primary.opacity(0.08)
        }
        static var subtleDivider: SwiftUI.Color {
            SwiftUI.Color.secondary.opacity(0.18)
        }
    }

    enum Material {
        static let regularGlass: Glass = .regular
        static let thin: SwiftUI.Material = .thinMaterial
        static let ultraThin: SwiftUI.Material = .ultraThinMaterial
    }

    enum Motion {
        static let feedback: Animation = .easeInOut(duration: 0.16)
        static let layout: Animation = .snappy
    }
}
