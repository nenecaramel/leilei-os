import SwiftUI
import UIKit

enum FloatingControlCenter {
    static let menu = "menu"
    static let search = "search"
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


extension View {
    func reportingSystemSearchControlCenter() -> some View {
        modifier(SystemSearchControlCenterReporter())
    }
}

private struct SystemSearchControlCenterReporter: ViewModifier {
    @State private var centerY: CGFloat?

    func body(content: Content) -> some View {
        content
            .background {
                SystemSearchControlCenterReader(centerY: $centerY)
                    .frame(width: 0, height: 0)
            }
            .preference(
                key: FloatingControlCenterPreferenceKey.self,
                value: centerY.map { [FloatingControlCenter.search: $0] } ?? [:]
            )
    }
}

private struct SystemSearchControlCenterReader: UIViewRepresentable {
    @Binding var centerY: CGFloat?

    func makeUIView(context: Context) -> SearchControlProbeView {
        let view = SearchControlProbeView()
        view.onCenterChange = { center in
            if centerY != center {
                centerY = center
            }
        }
        return view
    }

    func updateUIView(_ uiView: SearchControlProbeView, context: Context) {
        uiView.onCenterChange = { center in
            if centerY != center {
                centerY = center
            }
        }
        uiView.scheduleReport()
    }
}

private final class SearchControlProbeView: UIView {
    var onCenterChange: ((CGFloat) -> Void)?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        scheduleReport()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        scheduleReport()
    }

    func scheduleReport() {
        DispatchQueue.main.async { [weak self] in
            self?.reportSearchControlCenter()
        }
    }

    private func reportSearchControlCenter() {
        guard let window,
              let searchField = firstVisibleSearchField(in: window)
        else {
            return
        }

        let frame = searchField.convert(searchField.bounds, to: window)
        onCenterChange?(frame.midY)
    }

    private func firstVisibleSearchField(in root: UIView) -> UIView? {
        if let searchField = root as? UISearchTextField,
           !searchField.isHidden,
           searchField.alpha > 0.01,
           searchField.window != nil {
            return searchField
        }

        for subview in root.subviews.reversed() {
            if let match = firstVisibleSearchField(in: subview) {
                return match
            }
        }

        return nil
    }
}
