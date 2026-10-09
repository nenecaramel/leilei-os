import SwiftUI
import UIKit

// Runs only in a disposable simulator with synthetic text, never the real app.
@main
final class PaperTestAppDelegate: UIResponder, UIApplicationDelegate {
    static func main() {
        UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(Self.self))
    }
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: nil, sessionRole: session.role)
        configuration.delegateClass = PaperLayoutChecks.self
        return configuration
    }
}

final class PaperLayoutChecks: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    static var contentProbe: UIView?
    static let sample = "中文第一行：每行应该居中。\nSecond line: Typography 123.\n第三段很长的中文用来检测自然折行与横线是否逐行一致，不能只看第一行。这里继续添加内容确保折行。\n\n最后一段。"

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        self.window = window
        Task { @MainActor in
            var failures: [String] = []
            var checkedLines = 0
            for width: CGFloat in [320, 393, 768] {
                for mode in ["Memory", "Diary", "Todo"] {
                    let diary = mode == "Diary"
                    for text in [Self.sample, Self.sample + "\n", String(repeating: Self.sample + "\n", count: 8), "中文 English 👨‍👩‍👧‍👦\r\n第二行 ✨", "一行", ""] {
                        let controller = UIHostingController(rootView: surface(mode: mode, text: text))
                        window.frame = CGRect(x: 0, y: 0, width: width, height: 852)
                        window.rootViewController = controller
                        window.makeKeyAndVisible()
                        controller.view.frame = CGRect(x: 0, y: 0, width: width, height: 852)
                        controller.view.setNeedsLayout()
                        controller.view.layoutIfNeeded()
                        // Allow SwiftUI's representable size negotiation to finish.
                        try? await Task.sleep(for: .milliseconds(100))
                        controller.view.layoutIfNeeded()
                        let editors = textViews(controller.view)
                        guard let probe = Self.contentProbe, !editors.isEmpty else {
                            failures.append("missing hosted paper/editor")
                            continue
                        }
                        let origin = probe.convert(.zero, to: window).y
                        let font = UIFont.systemFont(ofSize: 14)
                        var previousBottom: CGFloat?
                        for editor in editors {
                            let frame = editor.convert(editor.bounds, to: window)
                            let expectedWidth = min(665, max(280, width - 46)) - 48
                            if abs(frame.width - expectedWidth) > 0.5 {
                                failures.append("test viewport not applied: \(frame.width), expected \(expectedWidth)")
                            }
                            let offset = frame.minY - origin
                            if abs(offset / 30 - (offset / 30).rounded()) > 0.02 {
                                failures.append("editor origin off grid: \(offset)")
                            }
                            if let bottom = previousBottom, abs(frame.minY - bottom - (mode == "Memory" ? 30 : 0)) > 0.5 {
                                failures.append("paper entry separator is off grid")
                            }
                            previousBottom = frame.maxY
                            if abs(frame.height / 30 - (frame.height / 30).rounded()) > 0.02 {
                                failures.append("editor height off grid: \(frame.height)")
                            }
                            let attributes = editor.attributedText.length == 0
                                ? editor.typingAttributes
                                : editor.attributedText.attributes(at: 0, effectiveRange: nil)
                            if (attributes[.font] as? UIFont)?.pointSize != 14 {
                                failures.append("body font is not 14pt")
                            }
                            // Never access layoutManager: that would silently switch to TextKit 1.
                            guard let manager = editor.textLayoutManager else {
                                failures.append("unexpected TextKit 1 fallback")
                                continue
                            }
                            manager.ensureLayout(for: manager.documentRange)
                            manager.enumerateTextLayoutFragments(from: manager.documentRange.location, options: [.ensuresLayout, .ensuresExtraLineFragment]) { fragment in
                                for line in fragment.textLineFragments {
                                    let range = line.characterRange
                                    let value = (line.attributedString.string as NSString).substring(with: range)
                                    // Blank rows have no visible glyph; they must still reserve space for the following row.
                                    guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
                                    let baselineOffset = (line.attributedString.attribute(.baselineOffset, at: range.location, effectiveRange: nil) as? NSNumber)?.doubleValue ?? 0
                                    let baseline = offset + editor.textContainerInset.top + fragment.layoutFragmentFrame.minY + line.typographicBounds.minY + line.glyphOrigin.y - CGFloat(baselineOffset)
                                    let center = baseline - (font.ascender + font.descender) / 2
                                    let expected = floor(center / 30) * 30 + 15
                                    if abs(center - expected) > 0.5 {
                                        failures.append("visible line center off grid: \(center), expected \(expected)")
                                    }
                                    checkedLines += 1
                                }
                                return true
                            }
                            if text.hasSuffix("\n") {
                                // UIKit's extra-line caret includes interline leading;
                                // do not mistake that rectangle for the visible glyph box.
                                // It must remain inside the allocated editor, without clipping.
                                let caret = editor.textInputView.convert(editor.caretRect(for: editor.endOfDocument), to: window)
                                if caret.minY < frame.minY - 0.5 || caret.maxY > frame.maxY + 0.5 {
                                    failures.append("trailing newline caret is clipped by the editor")
                                }
                            }
                        }
                        if diary, let first = editors.first, abs(first.convert(.zero, to: window).y - origin - 30) > 0.5 {
                            failures.append("Diary title does not reserve one grid row")
                        }
                    }
                }
            }
            let report = try! JSONSerialization.data(withJSONObject: ["failures": failures, "checkedLines": checkedLines])
            let output = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Caches/paper-layout-result.json")
            try! report.write(to: output, options: .atomic)
            print("Paper layout checks completed: \(checkedLines) lines, \(failures.count) failures")
            fflush(stdout)
            exit(failures.isEmpty ? 0 : 1)
        }
    }

    @MainActor private func surface(mode: String, text: String) -> some View {
        DaySpacePaperDetailLayer(dateLabel: "2026.10.09", errorMessage: nil, onRequestClose: {}) {
            Text("Cancel · Save").font(.system(size: 13))
        } signature: {
            Text(mode).font(.system(size: 20, design: .serif))
        } content: {
            VStack(alignment: .leading, spacing: mode == "Memory" ? 30 : 0) {
                if mode == "Diary" {
                    TextField("Title", text: .constant("标题 Title"))
                        .textFieldStyle(.plain).font(.system(size: 17, weight: .medium)).frame(height: 30)
                }
                ForEach(0..<(mode == "Memory" ? 3 : 1), id: \.self) { _ in
                    if mode == "Todo" {
                        DaySpaceTodoLineEditor(text: text, kind: .pending, rowID: "test", focusRequest: nil,
                            onTextChange: { _ in }, onSplit: { _ in false }, onMergePrevious: { false },
                            onMergeNext: { false }, onMovePrevious: { false }, onMoveNext: { false },
                            onPasteMultiline: { _, _ in false })
                    } else {
                        DaySpacePaperBodyEditor(text: text, disabled: false, onTextChange: { _ in }, minimumHeight: mode == "Diary" ? 420 : 30)
                    }
                }
            }.background(ContentOriginProbe())
        }
    }

    private func textViews(_ view: UIView) -> [UITextView] {
        if let editor = view as? UITextView { return [editor] }
        return view.subviews.flatMap(textViews)
    }
}

private struct ContentOriginProbe: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        PaperLayoutChecks.contentProbe = view
        return view
    }
    func updateUIView(_ view: UIView, context: Context) {}
}
