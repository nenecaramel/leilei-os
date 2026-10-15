import SwiftUI
import UIKit

// Native controls/source remain available independently of WebKit or visual success.
struct NativeLiveVisualSurface: View {
    let input: NativeLiveVisualSandboxInput
    let label: String
    var previewAction: (() -> Void)? = nil
    var compactInline = false
    // SVG already has an outer native card; don't nest glass inside glass.
    var embeddedInParentPanel = false

    @StateObject private var controller =
        NativeLiveVisualSandboxController()
    @State private var retry = 0
    @State private var showSource = false
    @State private var isCopied = false
    @State private var copyGeneration = 0
    @Environment(\.nativeLiveCopyFeedback)
    private var copyFeedback
    @Environment(\.colorScheme)
    private var colorScheme
    @Environment(\.scenePhase)
    private var scenePhase
    @ScaledMetric(relativeTo: .body)
    private var fontSize: CGFloat = 17

    var body: some View {
        Group {
            if compactInline {
                compactPreview
            } else {
                regularSurface
            }
        }
        .task(
            id:
                "\(input.identity)|\(colorScheme)|\(fontSize)|"
                + "\(retry)|\(scenePhase)"
        ) {
            if scenePhase == .active {
                controller.update(
                    input,
                    dark: colorScheme == .dark,
                    scale: Double(fontSize / 17),
                    retry: retry
                )
            } else {
                controller.stop()
            }
        }
        .onDisappear {
            controller.stop()
        }
    }

    private var regularSurface: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Spacer()

                Button("Source") {
                    showSource.toggle()
                }
                .font(.caption)

                if input.kind != .svg {
                    Button {
                        copySource()
                    } label: {
                        Image(
                            systemName:
                                isCopied
                                    ? "checkmark"
                                    : "square.on.square"
                        )
                        .font(.system(size: 15))
                        .rotationEffect(.degrees(isCopied ? 0 : 180))
                        .frame(width: 24, height: 24)
                    }
                    .foregroundStyle(.secondary)
                    .buttonStyle(.plain)
                    .accessibilityLabel(
                        isCopied
                            ? "Copied"
                            : "Copy \(label) source"
                    )
                }
            }

            if controller.state.phase == .loading
                || controller.state.phase == .ready {
                visualPreview

                if controller.state.phase == .loading {
                    Label(
                        "Rendering \(label.lowercased())…",
                        systemImage: "hourglass"
                    )
                    .font(.caption)
                }
            } else {
                Text(
                    controller.state.error
                        ?? "Visual preview paused"
                )
                .font(.caption)
                .foregroundStyle(.secondary)

                Button("Retry") {
                    retry += 1
                }
                .font(.caption)
            }

            if showSource
                || controller.state.phase == .failed
                || controller.state.phase == .fallback {
                ScrollView([.horizontal, .vertical]) {
                    Text(input.source)
                        .font(
                            .system(
                                .body,
                                design: .monospaced
                            )
                        )
                        .textSelection(.enabled)
                }
                .frame(maxHeight: 240)
                .accessibilityLabel("\(label) source")
            }
        }
        .padding(12)
        .modifier(NativeLiveIMessageContentPanel(
            originalOpacity: 0.045,
            originalCornerRadius: 10,
            embeddedInGlass: embeddedInParentPanel
        ))
    }

    @ViewBuilder
    private var visualPreview: some View {
        if input.kind == .math {
            ScrollView(
                .horizontal,
                showsIndicators: true
            ) {
                NativeLiveVisualSandbox(
                    controller: controller
                )
                .frame(
                    width: displayMathWidth,
                    height: controller.state.inlineHeight
                )
            }
            .frame(height: controller.state.inlineHeight)
            .accessibilityLabel(
                "Math: \(input.source)"
            )
        } else {
            NativeLiveVisualSandbox(
                controller: controller
            )
            .frame(
                height: controller.state.inlineHeight
            )
            .accessibilityLabel(label)
            .onTapGesture {
                previewAction?()
            }
        }
    }

    @ViewBuilder
    private var compactPreview: some View {
        if controller.state.phase == .loading
            || controller.state.phase == .ready {
            NativeLiveVisualSandbox(
                controller: controller
            )
            .frame(
                width: compactMathWidth,
                height: 44
            )
            .accessibilityLabel(
                "Math: \(input.source)"
            )
        } else {
            Text(input.source)
                .font(
                    .system(
                        size: 15,
                        design: .monospaced
                    )
                )
                .textSelection(.enabled)
        }
    }

    private var displayMathWidth: CGFloat {
        min(
            1_200,
            max(
                320,
                CGFloat(input.source.utf16.count)
                    * 7.2
                    + 64
            )
        )
    }

    private var compactMathWidth: CGFloat {
        min(
            320,
            max(
                42,
                CGFloat(input.source.utf16.count)
                    * 7.0
                    + 20
            )
        )
    }

    private func copySource() {
        UIPasteboard.general.string = input.source
        copyFeedback("Copied")
        copyGeneration += 1
        let generation = copyGeneration

        withAnimation(.easeInOut(duration: 0.16)) {
            isCopied = true
        }

        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            guard copyGeneration == generation else {
                return
            }

            withAnimation(.easeInOut(duration: 0.16)) {
                isCopied = false
            }
        }
    }
}

struct NativeLiveMathVisualRenderer: View {
    let model: NativeLiveMathPresentation

    var body: some View {
        if let input =
            try? NativeLiveVisualSandboxInput.displayMath(
                model
            ) {
            NativeLiveVisualSurface(
                input: input,
                label: "Math equation"
            )
        } else {
            NativeLiveMathRenderer(model: model)
        }
    }
}

struct NativeLiveMermaidRenderer: View {
    let model: NativeLiveCodePresentation

    var body: some View {
        if let input =
            try? NativeLiveVisualSandboxInput.mermaid(
                model
            ) {
            NativeLiveVisualSurface(
                input: input,
                label: "Mermaid diagram"
            )
        } else {
            VStack(alignment: .leading) {
                Text(
                    "Diagram source cannot be rendered safely"
                )
                .font(.caption)
                NativeLiveMermaidSourceRenderer(
                    model: model
                )
            }
        }
    }
}
