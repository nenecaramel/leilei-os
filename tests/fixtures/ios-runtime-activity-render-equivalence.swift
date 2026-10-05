import SwiftUI
import UIKit

private struct ActivityMeasure: ViewModifier {
    let name: String
    func body(content: Content) -> some View {
        content.background(GeometryReader { geometry in
            Color.clear.preference(key: ActivityFrames.self, value: [ActivityProbe.key(name): geometry.frame(in: .global)])
        })
    }
}
struct ActivityFrames: PreferenceKey {
    static var defaultValue: [String: CGRect] { [:] }
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) { value.merge(nextValue()) { _, new in new } }
}
private struct ActivityEnabled: ViewModifier {
    @Environment(\.isEnabled) var enabled
    let key: String
    func body(content: Content) -> some View {
        content.onAppear { ActivityProbe.enabled[ActivityProbe.key(key)] = enabled }
            .onChange(of: enabled) { _, value in ActivityProbe.enabled[ActivityProbe.key(key)] = value }
    }
}
extension View {
    func activityFrame(_ name: String) -> some View { modifier(ActivityMeasure(name: name)) }
    func activityEnabled(_ key: String) -> some View { modifier(ActivityEnabled(key: key)) }
}
@MainActor enum ActivityProbe {
    static var actions: [String: () -> Void] = [:], enabled: [String: Bool] = [:], states: [String: () -> Bool] = [:]
    static var trace: [String] = [], expansion: (() -> Bool)?
    static func key(_ value: String) -> String { value.replacingOccurrences(of: "Baseline", with: "").replacingOccurrences(of: "Rejected", with: "") }
    static func capture(_ key: String, _ action: @escaping () -> Void) -> () -> Void { actions[self.key(key)] = action; return action }
    static func invoke(_ key: String) { precondition(actions[key] != nil, "Missing compiled action \(key)"); if enabled[key] == true { actions[key]?() } }
    static func reset() { actions = [:]; enabled = [:]; states = [:]; trace = []; expansion = nil }
    static func resolve(_ interaction: NativeLiveRuntimeInteractionSnapshot, _ payload: [String: NativeLiveJSONValue]) async throws {
        trace.append("start:\(interaction.id):\(nativeLiveJSONDetail(.object(payload))!)")
        await Task.yield()
        trace.append("finish:\(interaction.id)")
    }
}
extension NativeLiveTurnActivityProjection {
    // Fixture-only construction keeps projection inputs explicit and never
    // substitutes or edits any production traversal/projection implementation.
    init(activityFixtureLifecycle: [LifecycleActivity] = [], tasks: [TaskActivity] = [], tools: [ToolActivity] = [], questions: [QuestionActivity] = [], interactions: [NativeLiveRuntimeInteractionSnapshot] = [], active: Bool = true) {
        prepareID = "prepare"; lifecycle = activityFixtureLifecycle; self.tasks = tasks; self.tools = tools
        questionActivities = questions; self.interactions = interactions; turnIsActive = active; turnFailed = false; elapsedSeconds = 3
    }
}
@MainActor enum ActivityFixtures {
    typealias P = NativeLiveTurnActivityProjection
    static let cases = ["timestamp", "header", "both", "collapsed", "expanded", "murmur", "murmur-empty", "lifecycle", "api-retry", "task-active", "task-completed", "task-failed", "task-cancelled", "task-background", "task-phase", "task-depth-negative", "task-depth-two", "task-depth-clamped", "task-tool", "task-question", "task-resources", "tool-running", "tool-completed", "tool-failed", "tool-unknown", "tool-input", "tool-output", "tool-resources", "nested-permission", "question-pending", "question-answered", "question-cancelled", "child-question", "unattached-question", "permission-pending", "permission-resolved", "question-resolved", "history-unknown", "history-cancelled", "mixed", "multi-tools", "multi-tasks", "complete", "result", "result-error", "murmur-sheet", "detail-sheet", "detail-empty", "expand", "collapse", "open-murmur", "open-resources", "open-tool", "open-question", "permission-allow", "permission-deny", "question-submit", "question-cancel", "nested-allow", "resolve-error"]
    static func interaction(_ kind: String, _ status: String = "pending", nested: Bool = false) -> NativeLiveRuntimeInteractionSnapshot {
        var request: [String: NativeLiveJSONValue] = ["toolName": .string("Read"), "description": .string("Read fixture.txt"), "questions": .array([.object(["question": .string("Theme?"), "header": .string("Theme"), "options": .array([.object(["label": .string("Dark"), "description": .string("Use dark theme")])])])])]
        if nested { request["toolUseId"] = .string("tool") }
        return .init(interactionID: nested ? "nested" : kind, prepareID: "prepare", kind: kind, request: request, status: status, response: status == "resolved" ? ["decision": .string(kind == "question" ? "answer" : "allow"), "answers": .object(["Theme?": .string("Dark")])] : nil, createdAt: "", updatedAt: "", resolvedAt: nil, cancelledAt: nil)
    }
    static func task(_ name: String, id: String = "task", depth: Int? = nil) -> P.TaskActivity {
        .init(id: id, toolUseID: "task-tool", description: "Inspect repository", summary: nil, resourceLinks: name.contains("resources") || name == "complete" ? [.string("https://example.invalid/resource")] : [], subagentType: "Research", taskType: nil, isBackgrounded: name.contains("background"), isAmbient: false, isActiveInBackgroundSet: true, hiddenFromTranscript: false, spawnDepth: depth, phase: "in_progress", status: name.contains("completed") ? "completed" : name.contains("failed") ? "failed" : name.contains("cancelled") ? "cancelled" : nil, order: 1)
    }
    static func tool(_ name: String, id: String = "tool", parent: String? = nil) -> P.ToolActivity {
        .init(id: id, toolName: "mcp__leileios__get_diary", providerToolName: "Read", questionMetadata: nil, input: .object(["path": .string("fixture.txt")]), output: name.contains("output") || name == "complete" ? .string("File contents") : nil, resourceLinks: name.contains("resources") || name == "complete" ? [.object(["uri": .string("fixture://resource")])] : [], parentToolUseID: parent, parentAgentID: nil, hiddenFromTranscript: false, hiddenFromActivity: false, state: name.contains("running") ? .running : name.contains("failed") ? .failed : name.contains("unknown") || name == "tool-input" ? .unknown : .completed, order: 2)
    }
    static func question(_ name: String, parent: String? = nil) -> P.QuestionActivity {
        let status = name.contains("answered") || name == "question-resolved" ? "Answered" : name.contains("cancelled") ? "Cancelled" : "Needs input"
        return .init(id: "question", parentToolUseID: parent, parentAgentID: nil, questionDetail: "Theme?", responseDetail: status == "Answered" ? "Theme?\nDark" : nil, statusLabel: status, interaction: interaction("question", status == "Answered" ? "resolved" : status == "Cancelled" ? "cancelled" : "pending"), order: 3)
    }
    static func projection(_ name: String) -> P {
        var tasks: [P.TaskActivity] = [], tools: [P.ToolActivity] = [], questions: [P.QuestionActivity] = [], interactions: [NativeLiveRuntimeInteractionSnapshot] = [], lifecycle: [P.LifecycleActivity] = []
        if name == "lifecycle" || name == "api-retry" || name == "complete" { lifecycle = [.init(id: "lifecycle", kind: name == "api-retry" ? "api_retry" : "command_lifecycle", title: "Message started", detail: "1 / 3", order: 0)] }
        if name.hasPrefix("task-") || ["mixed", "multi-tasks", "complete", "open-resources"].contains(name) { tasks = [task(name == "open-resources" ? "task-resources" : name, depth: name.contains("negative") ? -2 : name.contains("two") ? 2 : name.contains("clamped") ? 8 : nil)] }
        if name == "multi-tasks" { tasks.append(task("task-completed", id: "task2", depth: 1)) }
        if name.hasPrefix("tool-") || ["nested-permission", "nested-allow", "mixed", "multi-tools", "complete", "open-tool", "task-tool", "child-question"].contains(name) { tools = [tool(name, parent: name == "task-tool" || name == "complete" ? "task-tool" : nil)] }
        if name == "multi-tools" { tools.append(tool("tool-failed", id: "tool2")) }
        if name.hasPrefix("question-") || ["task-question", "child-question", "unattached-question", "mixed", "complete", "open-question"].contains(name) { questions = [question(name, parent: name == "task-question" || name == "complete" ? "task-tool" : name == "child-question" ? "tool" : name == "unattached-question" ? "expired-parent" : nil)] }
        if name.hasPrefix("permission-") || name == "resolve-error" { interactions = [interaction("permission", name == "permission-resolved" ? "resolved" : "pending")] }
        if name.hasPrefix("nested-") || name == "complete" { interactions.append(interaction("permission", nested: true)) }
        if name.hasPrefix("history-") { interactions = [interaction("unknown", name == "history-cancelled" ? "cancelled" : "resolved")] }
        return .init(activityFixtureLifecycle: lifecycle, tasks: tasks, tools: tools, questions: questions, interactions: interactions, active: name != "task-background")
    }
}
private struct ActivityHost: View {
    let name: String, version: Int
    @State var expansion: NativeLiveMessageUIStateStore.State
    init(_ name: String, _ version: Int) { self.name = name; self.version = version; _expansion = State(initialValue: .init(activityExpansion: ["collapsed", "expand"].contains(name) ? .collapsed : .userExpanded)) }
    var body: some View {
        let projection = ActivityFixtures.projection(name)
        let timestamp: String? = name == "header" ? nil : "02:14"
        let header = name == "timestamp" ? "" : "Worked for 3s"
        let murmur: String? = ["murmur", "open-murmur"].contains(name) ? "  A quiet thought.\n" : name == "murmur-empty" ? " \n" : nil
        let resolve: (NativeLiveRuntimeInteractionSnapshot, [String: NativeLiveJSONValue]) async throws -> Void = { interaction, response in
            try await ActivityProbe.resolve(interaction, response)
            if name == "resolve-error" { throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Fixture resolve failed"]) }
        }
        Group {
            if name == "murmur-sheet" {
                if version == 0 { BaselineNativeLiveMurmurSheet(text: "A quiet thought.") } else { NativeLiveMurmurSheet(text: "A quiet thought.") }
            } else if name.hasPrefix("detail-") {
                if version == 0 { BaselineNativeLiveToolDetailSheet(title: "Read Diary", status: "Done", sectionTitle: "Input", detail: name == "detail-empty" ? nil : "{path: fixture.txt}", secondarySectionTitle: "Output", secondaryDetail: "File contents", tertiarySectionTitle: "Resources", tertiaryDetail: "[fixture://resource]") }
                else { NativeLiveToolDetailSheet(title: "Read Diary", status: "Done", sectionTitle: "Input", detail: name == "detail-empty" ? nil : "{path: fixture.txt}", secondarySectionTitle: "Output", secondaryDetail: "File contents", tertiarySectionTitle: "Resources", tertiaryDetail: "[fixture://resource]") }
            } else if name.hasPrefix("result") {
                if version == 0 { BaselineNativeLiveToolResultCard(isError: name == "result-error", detail: "File contents") } else { NativeLiveToolResultCard(isError: name == "result-error", detail: "File contents") }
            } else {
                if version == 0 { BaselineNativeLiveTurnActivityView(projection: projection, timestampText: timestamp, header: header, murmurText: murmur, expansion: $expansion, onResolveInteraction: resolve) }
                else if version == 2 { RejectedNativeLiveTurnActivityView(projection: projection, timestampText: timestamp, header: header, murmurText: murmur, expansion: $expansion, onResolveInteraction: resolve) }
                else { NativeLiveTurnActivityView(projection: projection, timestampText: timestamp, header: header, murmurText: murmur, expansion: $expansion, onResolveInteraction: resolve) }
            }
        }.activityFrame("root").padding(.horizontal, 16).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .onAppear { ActivityProbe.expansion = { expansion.isActivityExpanded } }
    }
}
@MainActor final class ActivityFrameStore { var frames: [String: CGRect] = [:] }
@MainActor enum ActivityChecks {
    struct Sample { let width: Int; let frames: [String: CGRect]; let pixels: [UInt8]; let opaquePixels: [UInt8]; let systemGlass: [CGRect]; let trace: [String]; let states: [String: Bool]; let expanded: Bool; let enabled: [String: Bool] }
    static func run(_ scene: UIWindowScene) async {
        let tablet = UIDevice.current.userInterfaceIdiom == .pad, width = tablet ? 1024 : 390, height = tablet ? 1800 : 1500
        var count = 0, frames = 0, callbacks = 0
        let selected = ProcessInfo.processInfo.environment["ACTIVITY_CASES"].map { $0.split(separator: ",").map(String.init) } ?? ActivityFixtures.cases
        for dark in [false, true] { for name in selected {
            let baseline = await sample(name, 0, scene, width, height, dark)
            let current = await sample(name, 1, scene, width, height, dark)
            compare(baseline, current, name)
            precondition(baseline.trace == current.trace && baseline.states == current.states && baseline.expanded == current.expanded && baseline.enabled == current.enabled, "Behavior mismatch \(name): \(baseline.trace) / \(current.trace)")
            count += 1; frames += baseline.frames.count; callbacks += current.trace.count
            print("activity \(name)/\(dark): \(baseline.frames.count) exact frames; trace=\(current.trace); states=\(current.states)"); fflush(stdout)
        } }
        let baseline = await sample("tool-completed", 0, scene, width, height, false)
        let wrong = await sample("tool-completed", 2, scene, width, height, false)
        precondition(baseline.frames != wrong.frames && baseline.pixels != wrong.pixels, "Negative vertical padding escaped")
        if ProcessInfo.processInfo.environment["ACTIVITY_NEGATIVE"] == "1" { compare(baseline, wrong, "negative padding 9 -> 10") }
        print("RuntimeActivity equivalence PASS: \(count) cases / \(frames) exact frames / \(callbacks) callback events; static pixel diff 0; negative padding detected; device=\(tablet ? "iPad" : "iPhone")"); fflush(stdout)
    }
    static func compare(_ baseline: Sample, _ current: Sample, _ name: String) {
        precondition(baseline.frames == current.frames, "Frame mismatch \(name): \(baseline.frames) / \(current.frames)")
        var staticDifference = 0, systemDifference = 0
        for index in stride(from: 0, to: baseline.pixels.count, by: 4) where baseline.pixels[index..<index+4] != current.pixels[index..<index+4] {
            let point = CGPoint(x: (index / 4) % baseline.width, y: (index / 4) / baseline.width)
            if baseline.systemGlass.contains(where: { $0.insetBy(dx: -12, dy: -12).contains(point) }) { systemDifference += 1 }
            else { staticDifference += 1 }
        }
        precondition(staticDifference == 0, "Static pixel mismatch \(name): \(staticDifference)")
        // A second pass hides ONLY UIKit's system shared glass backing. It
        // protects the Done glyph, foreground, sheet content and every static
        // pixel, while the raw pass still checks glass geometry exactly.
        if baseline.opaquePixels != current.opaquePixels {
            var bounds = CGRect.null, count = 0
            for index in stride(from: 0, to: baseline.opaquePixels.count, by: 4) where baseline.opaquePixels[index..<index+4] != current.opaquePixels[index..<index+4] {
                bounds = bounds.union(CGRect(x: (index / 4) % baseline.width, y: (index / 4) / baseline.width, width: 1, height: 1)); count += 1
            }
            print("OPAQUE MISMATCH \(name): \(count) bounds=\(bounds); frames=\(baseline.frames)"); fflush(stdout)
        }
        precondition(baseline.opaquePixels == current.opaquePixels, "Opaque navigation backing pixel mismatch \(name)")
        print("pixels \(name): static=0; opaque=0; system glass=\(systemDifference)"); fflush(stdout)
    }
    static func sample(_ name: String, _ version: Int, _ scene: UIWindowScene, _ width: Int, _ height: Int, _ dark: Bool) async -> Sample {
        ActivityProbe.reset(); let store = ActivityFrameStore()
        let host = UIHostingController(rootView: ActivityHost(name, version).environment(\.colorScheme, dark ? .dark : .light).onPreferenceChange(ActivityFrames.self) { store.frames = $0 }.background(Color(.systemBackground)))
        let window = UIWindow(windowScene: scene); window.frame = CGRect(x: 0, y: 0, width: width, height: height); window.overrideUserInterfaceStyle = dark ? .dark : .light
        window.rootViewController = host; window.makeKeyAndVisible(); host.view.frame = window.bounds
        host.view.layoutIfNeeded(); try? await Task.sleep(for: .milliseconds(450)); host.view.layoutIfNeeded()
        var measured = store.frames, glass: [CGRect] = [], items: [UIBarButtonItem] = [], spinnerCount = 0
        func inspect(_ view: UIView, inNavigation: Bool = false) {
            if view is UIActivityIndicatorView {
                measured["spinner.uikit.\(spinnerCount)"] = view.convert(view.bounds, to: host.view); spinnerCount += 1
            }
            let navigation = inNavigation || view is UINavigationBar
            if let bar = view as? UINavigationBar { items += (bar.topItem?.leftBarButtonItems ?? []) + (bar.topItem?.rightBarButtonItems ?? []) }
            if navigation && String(describing: type(of: view)) == "_UIButtonBarButton" {
                let frame = view.convert(view.bounds, to: host.view); glass.append(frame); measured["system.nav-button.\(glass.count)"] = frame
            }
            for child in view.subviews { inspect(child, inNavigation: navigation) }
        }
        inspect(host.view)
        glass += measured.filter { $0.key.hasPrefix("system.nav-button") }.map(\.value)
        func raster() -> [UInt8] {
            let format = UIGraphicsImageRendererFormat(); format.scale = 1
            let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in host.view.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
            var bytes = [UInt8](repeating: 0, count: width * height * 4)
            bytes.withUnsafeMutableBytes { raw in let context = CGContext(data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!; context.draw(image.cgImage!, in: window.bounds) }
            // Exact SwiftUI + UIKit spinner geometry remains compared. Only
            // rotating pixels and their 2px antialias fringe are dynamic.
            for (key, frame) in measured where key.hasPrefix("spinner") {
                let rect = frame.insetBy(dx: -2, dy: -2)
                for y in max(0, Int(rect.minY))..<min(height, Int(ceil(rect.maxY))) { for x in max(0, Int(rect.minX))..<min(width, Int(ceil(rect.maxX))) { for c in 0..<4 { bytes[(y * width + x) * 4 + c] = 0 } } }
            }
            return bytes
        }
        let pixels = raster()
        let previousBacking = items.map(\.hidesSharedBackground)
        for item in items { item.hidesSharedBackground = true }
        host.view.layoutIfNeeded(); try? await Task.sleep(for: .milliseconds(100))
        let opaquePixels = raster()
        for (item, hidden) in zip(items, previousBacking) { item.hidesSharedBackground = hidden }
        func click(_ key: String) async { ActivityProbe.invoke(key); try? await Task.sleep(for: .milliseconds(250)) }
        switch name {
        case "expand", "collapse": await click("NativeLiveTurnActivityView.button0-"); precondition(ActivityProbe.expansion?() == (name == "expand"))
        case "open-murmur": await click("NativeLiveTurnActivityView.button1-"); precondition(ActivityProbe.states["NativeLiveTurnActivityView-"]?() == true)
        case "open-resources": await click("NativeLiveTaskResourceRow.button0-task"); precondition(ActivityProbe.states["NativeLiveTaskResourceRow-task"]?() == true)
        case "open-tool": await click("NativeLiveToolCallCard.button0-"); precondition(ActivityProbe.states["NativeLiveToolCallCard-"]?() == true)
        case "open-question": await click("NativeLiveQuestionActivityRow.button0-question"); precondition(ActivityProbe.states["NativeLiveQuestionActivityRow-question"]?() == true)
        case "permission-allow", "resolve-error": await click("NativeLivePermissionInteractionCard.button1-permission")
        case "permission-deny": await click("NativeLivePermissionInteractionCard.button0-permission")
        case "nested-allow": await click("NativeLivePermissionInteractionCard.button1-nested")
        case "question-cancel": await click("NativeLiveQuestionInteractionCard.button1-question")
        case "question-submit":
            precondition(ActivityProbe.enabled["NativeLiveQuestionInteractionCard.button2-question"] == false)
            await click("NativeLiveQuestionInteractionCard.button0-question")
            await click("NativeLiveQuestionInteractionCard.button2-question")
        default: break
        }
        if name.hasPrefix("open-") { precondition(host.presentedViewController != nil, "Compiled sheet was not actually presented: \(name)") }
        if ["permission-allow", "permission-deny", "nested-allow", "question-cancel", "question-submit", "resolve-error"].contains(name) {
            let id = name == "nested-allow" ? "nested" : name.hasPrefix("question") ? "question" : "permission"
            let payload: [String: NativeLiveJSONValue] = name == "permission-deny" ? ["decision": .string("deny"), "message": .string("Denied by user in LeileiOS."), "interrupt": .bool(false)] : name == "question-cancel" ? ["decision": .string("cancel"), "message": .string("User dismissed the question.")] : name == "question-submit" ? ["decision": .string("answer"), "answers": .object(["Theme?": .string("Dark")])] : ["decision": .string("allow")]
            precondition(ActivityProbe.trace == ["start:\(id):\(nativeLiveJSONDetail(.object(payload))!)", "finish:\(id)"], "Wrong callback payload/count/order \(name): \(ActivityProbe.trace)")
            if name != "resolve-error" { precondition(ActivityProbe.enabled.values.contains(false), "Submit disabled guard missing") }
            else { precondition(ActivityProbe.enabled["NativeLivePermissionInteractionCard.button1-permission"] == true) }
        }
        let result = Sample(width: width, frames: measured, pixels: pixels, opaquePixels: opaquePixels, systemGlass: glass, trace: ActivityProbe.trace, states: Dictionary(uniqueKeysWithValues: ActivityProbe.states.map { (ActivityProbe.key($0.key), $0.value()) }), expanded: ActivityProbe.expansion?() ?? false, enabled: ActivityProbe.enabled)
        host.dismiss(animated: false); window.isHidden = true; try? await Task.sleep(for: .milliseconds(100)); return result
    }
}
final class ActivityAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ app: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration { let configuration = UISceneConfiguration(name: "Tests", sessionRole: session.role); configuration.delegateClass = ActivitySceneDelegate.self; return configuration }
}
final class ActivitySceneDelegate: NSObject, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }; window = UIWindow(windowScene: scene); window?.rootViewController = UIViewController(); window?.makeKeyAndVisible()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { Task { await ActivityChecks.run(scene); exit(0) } }
    }
}
@main struct ActivityApp { static func main() { UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(ActivityAppDelegate.self)) } }
