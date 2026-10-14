import SwiftUI
import UIKit

private struct SidebarFrames: PreferenceKey {
    static var defaultValue: [String: CGRect] { [:] }
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

extension View {
    func testSidebarFrame(_ name: String) -> some View {
        background(GeometryReader { proxy in
            Color.clear.preference(key: SidebarFrames.self, value: [name: proxy.frame(in: .global)])
        })
    }
}

@MainActor
private final class FrameStore { var values: [String: CGRect] = [:] }

@MainActor
struct SidebarEquivalenceChecks {
    private struct Snapshot {
        let frames: [String: CGRect]
        let pixels: [UInt8]
        let width: Int
    }

    static func run(in scene: UIWindowScene) {
        let sentinelFormat = UIGraphicsImageRendererFormat(); sentinelFormat.scale = 1
        let sentinel = UIGraphicsImageRenderer(size: CGSize(width: 1, height: 2), format: sentinelFormat).image { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 1, height: 1))
            UIColor.blue.setFill(); context.fill(CGRect(x: 0, y: 1, width: 1, height: 1))
        }
        var sentinelBytes = [UInt8](repeating: 0, count: 8)
        sentinelBytes.withUnsafeMutableBytes { bytes in
            CGContext(data: bytes.baseAddress, width: 1, height: 2, bitsPerComponent: 8, bytesPerRow: 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
                .draw(sentinel.cgImage!, in: CGRect(x: 0, y: 0, width: 1, height: 2))
        }
        precondition(sentinelBytes == [255, 0, 0, 255, 0, 0, 255, 255], "Raster rows must follow UIKit top-to-bottom coordinates")
        print("Sidebar raster coordinate sentinel: UIKit top-to-bottom rows verified"); fflush(stdout)
        let activeID = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
        let conversations = [
            NativeLiveConversationSummary(id: activeID.uuidString, title: "Active conversation", currentHeadMessageId: nil, createdAt: "2026-10-05", updatedAt: "2026-10-05"),
            NativeLiveConversationSummary(id: "00000000-0000-0000-0000-000000000002", title: "Another conversation", currentHeadMessageId: nil, createdAt: "2026-10-05", updatedAt: "2026-10-05")
        ]
        var cases = 0
        for width in [300, 280] {
            for dark in [false, true] {
                for page in [AppPage.diary, .daySpace, .mind, .universe, .chat] {
                    let baseline = sample(AnyView(BaselineSidebarView(
                        selectedPage: .constant(page), menuButtonCenterY: nil,
                        onNewSession: {}, newSessionEnabled: true, conversations: conversations,
                        activeConversationID: activeID, onOpenConversation: { _ in }, onSettings: {}, onSelect: {}
                    )), scene: scene, width: width, dark: dark)
                    #if REJECTED_AS_CURRENT
                    let currentView = AnyView(RejectedSidebarView(
                        selectedPage: .constant(page), menuButtonCenterY: nil,
                        onNewSession: {}, newSessionEnabled: true, conversations: conversations,
                        activeConversationID: activeID, onOpenConversation: { _ in }, onSettings: {}, onSelect: {}
                    ))
                    #else
                    let currentView = AnyView(SidebarView(
                        selectedPage: .constant(page), menuButtonCenterY: nil,
                        onNewSession: {}, newSessionEnabled: true, conversations: conversations,
                        activeConversationID: activeID, onOpenConversation: { _ in }, onSettings: {}, onSelect: {}
                    ))
                    #endif
                    let current = sample(currentView, scene: scene, width: width, dark: dark)
                    precondition(baseline.frames.count == 24, "all critical frame anchors must be measured: \(baseline.frames.keys.sorted())")
                    for name in baseline.frames.keys.sorted() {
                        precondition(baseline.frames[name] == current.frames[name],
                            "frame mismatch \(name): baseline=\(String(describing: baseline.frames[name])) current=\(String(describing: current.frames[name]))")
                    }
                    precondition(baseline.frames.keys.sorted() == current.frames.keys.sorted())
                    let differences = pixelDifferences(baseline, current)
                    precondition(differences.staticPixels == 0, "static pixel mismatch: \(differences)")
                    let rejected = sample(AnyView(RejectedSidebarView(
                        selectedPage: .constant(page), menuButtonCenterY: nil,
                        onNewSession: {}, newSessionEnabled: true, conversations: conversations,
                        activeConversationID: activeID, onOpenConversation: { _ in }, onSettings: {}, onSelect: {}
                    )), scene: scene, width: width, dark: dark)
                    precondition(rejected.frames != baseline.frames && pixelDifferences(baseline, rejected).staticPixels > 0,
                        "comparator must reject the former unified-gutter version")
                    cases += 1
                    print("width=\(width) dark=\(dark) page=\(page.id): 24 exact frames; static pixels=0; system glass pixels=\(differences.glassPixels); rejected gutter detected")
                    fflush(stdout)
                }
            }
        }
        print("Sidebar render equivalence PASS: \(cases) cases / \(cases * 24) exact frame comparisons")
        fflush(stdout)
    }

    private static func sample(_ content: AnyView, scene: UIWindowScene, width: Int, dark: Bool) -> Snapshot {
        let store = FrameStore()
        let root = content.frame(width: CGFloat(width), height: 844)
            .background(dark ? Color.black : Color.white)
            .environment(\.colorScheme, dark ? .dark : .light)
            .onPreferenceChange(SidebarFrames.self) { store.values = $0 }
        let host = UIHostingController(rootView: root)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: width, height: 844)
        window.overrideUserInterfaceStyle = dark ? .dark : .light
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = window.bounds
        host.view.setNeedsLayout()
        host.view.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.35))
        for button in buttons(in: host.view) {
            if let label = button.accessibilityLabel {
                store.values["floating.\(label)"] = button.convert(button.bounds, to: host.view)
            }
        }
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
            host.view.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        var pixels = [UInt8](repeating: 0, count: width * 844 * 4)
        pixels.withUnsafeMutableBytes { bytes in
            let context = CGContext(data: bytes.baseAddress, width: width, height: 844,
                bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(image.cgImage!, in: CGRect(x: 0, y: 0, width: width, height: 844))
        }
        window.isHidden = true
        return Snapshot(frames: store.values, pixels: pixels, width: width)
    }

    private static func buttons(in view: UIView) -> [UIButton] {
        (view as? UIButton).map { [$0] } ?? view.subviews.flatMap { buttons(in: $0) }
    }

    private static func pixelDifferences(_ lhs: Snapshot, _ rhs: Snapshot) -> (staticPixels: Int, glassPixels: Int) {
        // UIKit glass samples the active window backdrop and has system-owned
        // compositing/settling. Exclude only those control/shadow regions from
        // strict pixel equality; their actual UIButton frames compare exactly.
        let glass = lhs.frames.filter { $0.key.hasPrefix("floating.") }.map { $0.value.insetBy(dx: -12, dy: -12) }
        var staticPixels = 0; var glassPixels = 0; var mismatch = CGRect.null
        for p in 0..<(lhs.width * 844) {
            let i = p * 4
            if lhs.pixels[i..<i + 4].elementsEqual(rhs.pixels[i..<i + 4]) { continue }
            // The top-red/bottom-blue sentinel proves these CGImage raster rows
            // already follow UIKit coordinates; flipping them misclassifies footer glass.
            let point = CGPoint(x: CGFloat(p % lhs.width) + 0.5, y: CGFloat(p / lhs.width) + 0.5)
            if glass.contains(where: { $0.contains(point) }) { glassPixels += 1 } else { staticPixels += 1; mismatch = mismatch.union(CGRect(origin: point, size: CGSize(width: 1, height: 1))) }
        }
        if staticPixels > 0 { print("Sidebar mismatch bounds=\(mismatch) glass=\(glass)"); fflush(stdout) }
        return (staticPixels, glassPixels)
    }
}

final class EquivalenceAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Tests", sessionRole: session.role)
        configuration.delegateClass = EquivalenceSceneDelegate.self
        return configuration
    }
}

final class EquivalenceSceneDelegate: NSObject, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        window = UIWindow(windowScene: scene)
        window?.rootViewController = UIViewController(); window?.makeKeyAndVisible()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            SidebarEquivalenceChecks.run(in: scene); exit(0)
        }
    }
}

@main
struct EquivalenceApplication {
    static func main() {
        UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(EquivalenceAppDelegate.self))
    }
}
