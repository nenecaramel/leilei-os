import SwiftUI
import UIKit

// Native controls/source remain available independently of WebKit or visual success.
struct NativeLiveVisualSurface: View {
    let input: NativeLiveVisualSandboxInput
    let label: String
    var previewAction: (() -> Void)? = nil
    @StateObject private var controller = NativeLiveVisualSandboxController()
    @State private var retry = 0
    @State private var showSource = false
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scenePhase) private var scenePhase
    @ScaledMetric(relativeTo: .body) private var fontSize: CGFloat = 17
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Source") { showSource.toggle() }.font(.caption)
                if input.kind != .svg {
                    Button { UIPasteboard.general.string = input.source } label: { Image(systemName:"doc.on.doc") }
                        .accessibilityLabel("Copy \(label) source")
                }
            }
            if controller.state.phase == .loading || controller.state.phase == .ready {
                NativeLiveVisualSandbox(controller: controller)
                    .frame(height: controller.state.inlineHeight)
                    .accessibilityLabel(input.kind == .math ? "Math: \(input.source)" : label)
                    .onTapGesture { previewAction?() }
                if controller.state.phase == .loading { Label("Rendering \(label.lowercased())…",systemImage:"hourglass").font(.caption) }
            } else {
                Text(controller.state.error ?? "Visual preview paused").font(.caption).foregroundStyle(.secondary)
                Button("Retry") { retry += 1 }.font(.caption)
            }
            if showSource || controller.state.phase == .failed || controller.state.phase == .fallback {
                ScrollView([.horizontal,.vertical]) { Text(input.source).font(.system(.body,design:.monospaced)).textSelection(.enabled) }
                    .frame(maxHeight:240).accessibilityLabel("\(label) source")
            }
        }
        .padding(12).background(Color.primary.opacity(0.045),in:RoundedRectangle(cornerRadius:10))
        .task(id: "\(input.identity)|\(colorScheme)|\(fontSize)|\(retry)|\(scenePhase)") {
            if scenePhase == .active { controller.update(input,dark:colorScheme == .dark,scale:Double(fontSize/17),retry:retry) }
            else { controller.stop() }
        }
        .onDisappear { controller.stop() }
    }
}

struct NativeLiveMathVisualRenderer: View {
    let model: NativeLiveMathPresentation
    var body: some View {
        if let input = try? NativeLiveVisualSandboxInput.displayMath(model) {
            NativeLiveVisualSurface(input:input,label:"Math equation")
        } else { NativeLiveMathRenderer(model:model) }
    }
}
struct NativeLiveMermaidRenderer: View {
    let model: NativeLiveCodePresentation
    var body: some View {
        if let input = try? NativeLiveVisualSandboxInput.mermaid(model) {
            NativeLiveVisualSurface(input:input,label:"Mermaid diagram")
        } else {
            VStack(alignment:.leading) {
                Text("Diagram source cannot be rendered safely").font(.caption)
                NativeLiveMermaidSourceRenderer(model:model)
            }
        }
    }
}
