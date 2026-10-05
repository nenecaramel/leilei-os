import SwiftUI
import UIKit

@main
@MainActor
struct UITokenChecks {
    static func main() {
        // These expected values are the pre-UI-0 consumer-visible geometry.
        let icon = UIHostingController(rootView: ComposerCircleButton(systemName: "plus"))
        precondition(icon.sizeThatFits(in: CGSize(width: 320, height: 200)) == CGSize(width: 36, height: 36))
        let capsule = UIHostingController(rootView: CombinedModelCapsule(model: "Claude", effort: "High"))
        precondition(capsule.sizeThatFits(in: CGSize(width: 320, height: 200)).height == 36)
        precondition(LeileiUI.Typography.controlGlyph(weight: .regular) == Font.system(size: 15, weight: .regular))
        precondition(LeileiUI.Typography.controlGlyph(weight: .semibold) == Font.system(size: 15, weight: .semibold))
        precondition(LeileiUI.Motion.feedback == Animation.easeInOut(duration: 0.16))
        precondition(LeileiUI.Motion.layout == Animation.snappy)
        for style in [UIUserInterfaceStyle.light, .dark] {
            let traits = UITraitCollection(userInterfaceStyle: style)
            let page = UIColor(LeileiUI.Color.pageBackground).resolvedColor(with: traits)
            let fill = UIColor(LeileiUI.Color.softFill).resolvedColor(with: traits)
            precondition(page.isEqual(UIColor.systemBackground.resolvedColor(with: traits)))
            precondition(fill.isEqual(UIColor.quaternarySystemFill.resolvedColor(with: traits)))
            precondition(UIColor(Color.chatSoftFill).resolvedColor(with: traits).isEqual(fill))
        }
        print("UI token equivalence PASS")
    }
}
