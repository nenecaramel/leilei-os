import SwiftUI

enum FloatingControlCenter {
    static let menu = "menu"
}

struct FloatingControlCenterPreferenceKey: PreferenceKey {
    static var defaultValue: [String: CGFloat] = [:]

    static func reduce(
        value: inout [String: CGFloat],
        nextValue: () -> [String: CGFloat]
    ) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

extension View {
    func reportingFloatingControlCenter(_ identifier: String) -> some View {
        background {
            GeometryReader { proxy in
                Color.clear.preference(
                    key: FloatingControlCenterPreferenceKey.self,
                    value: [identifier: proxy.frame(in: .global).midY]
                )
            }
        }
    }
}
