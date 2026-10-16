import SwiftUI
import Foundation

struct NativeLiveTurnActivityView: View {
    @Environment(\.chatTheme) private var chatTheme
    @Environment(\.iMessageWallpaperVisible) private var iMessageWallpaperVisible
    let projection: NativeLiveTurnActivityProjection
    let timestampText: String?
    let onResolveInteraction:
        ((
            NativeLiveRuntimeInteractionSnapshot,
            [String: NativeLiveJSONValue]
        ) async throws -> Void)?

    @Binding var expansion: NativeLiveMessageUIStateStore.State
    let header: String
    let murmurText: String?

    @State private var isShowingMurmur = false

    init(
        projection: NativeLiveTurnActivityProjection,
        timestampText: String? = nil,
        header: String,
        murmurText: String? = nil,
        expansion: Binding<NativeLiveMessageUIStateStore.State>,
        onResolveInteraction:
            ((
                NativeLiveRuntimeInteractionSnapshot,
                [String: NativeLiveJSONValue]
            ) async throws -> Void)?
    ) {
        self.projection = projection
        self.header = header
        self.murmurText = murmurText
        self._expansion = expansion
        self.timestampText = timestampText
        self.onResolveInteraction = onResolveInteraction
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(
                alignment: chatTheme == .iMessage ? .center : .firstTextBaseline,
                spacing: 8
            ) {
                Button {
                    expansion.toggleActivity()
                } label: {
                    HStack(
                        alignment: chatTheme == .iMessage ? .center : .firstTextBaseline,
                        spacing: chatTheme == .iMessage ? 8 : 12
                    ) {
                        if let timestampText {
                            Text(timestampText)
                                .font(.system(size: 12))
                                .tracking(0.12)
                                .foregroundStyle(iMessageWallpaperVisible ? Color.white : Color.secondary)
                                .fixedSize(
                                    horizontal: true,
                                    vertical: false
                                )
                        }

                        if !header.isEmpty {
                            Text(header)
                                .font(.system(size: 14))
                                .foregroundStyle(iMessageWallpaperVisible ? Color.white : Color.secondary)
                                .lineLimit(1)
                        }

                    }
                    .frame(
                        alignment: .leading
                    )
                    // iMessage Work text starts at the Thought process icon's
                    // left edge (2pt inset), without reserving space for a glyph.
                    .padding(.leading, chatTheme == .iMessage && !header.isEmpty ? 2 : 0)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(header.isEmpty)

                if !header.isEmpty {
                    Button {
                        expansion.toggleActivity()
                    } label: {
                        Image(
                            systemName:
                                effectiveExpanded
                                    ? "chevron.down"
                                    : "chevron.right"
                        )
                        .font(.system(size: 14, weight: .light))
                        .foregroundStyle(iMessageWallpaperVisible ? Color.white : Color.secondary)
                        .frame(height: 22)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(
                        effectiveExpanded
                            ? "Collapse activity"
                            : "Expand activity"
                    )
                }
                if normalizedMurmurText != nil {
                    Button {
                        isShowingMurmur = true
                    } label: {
                        Image(systemName: "bubble.left")
                            .font(.system(
                                size: 12.5,
                                weight: .medium
                            ))
                            .foregroundStyle(iMessageWallpaperVisible ? Color.white : Color.secondary)
                            .frame(width: 22, height: 22)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Murmur")
                }

                Spacer(minLength: 8)
            }
            .shadow(
                color: iMessageWallpaperVisible ? Color.black.opacity(0.75) : .clear,
                radius: iMessageWallpaperVisible ? 2 : 0,
                y: iMessageWallpaperVisible ? 1 : 0
            )

            if effectiveExpanded {
                VStack(alignment: .leading, spacing: 9) {
                    ForEach(projection.lifecycle) { lifecycle in
                        NativeLiveLifecycleActivityRow(
                            lifecycle: lifecycle
                        )
                    }

                    ForEach(projection.tasks) { task in
                        NativeLiveTaskActivityRow(
                            task: task,
                            prepareID: projection.prepareID,
                            childTools:
                                projection.childTools(for: task),
                            childQuestions: projection.childQuestions(for: task),
                            permissionInteractions: { tool in
                                projection.permissionInteractions(
                                    for: tool
                                )
                            },
                            turnIsActive: projection.turnIsActive,
                            onResolveInteraction: onResolveInteraction
                        )
                    }

                    ForEach(projection.topLevelTools) { tool in
                        VStack(alignment: .leading, spacing: 8) {
                            NativeLiveToolActivityRow(
                                tool: tool,
                                permissionInteractions:
                                    projection.permissionInteractions(for: tool),
                                onResolveInteraction: onResolveInteraction
                            )
                            ForEach(projection.childQuestions(forToolUseID: tool.id)) { question in
                                NativeLiveQuestionActivityRow(
                                    question: question,
                                    onResolveInteraction: onResolveInteraction
                                )
                                .padding(.leading, 23)
                            }
                        }
                    }

                    ForEach(projection.topLevelQuestions) { question in
                        NativeLiveQuestionActivityRow(
                            question: question,
                            onResolveInteraction: onResolveInteraction
                        )
                    }

                    if !projection.unattachedQuestions.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Task activity")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            ForEach(projection.unattachedQuestions) { question in
                                NativeLiveQuestionActivityRow(
                                    question: question,
                                    onResolveInteraction: onResolveInteraction
                                )
                                .padding(.leading, 23)
                            }
                        }
                    }

                    ForEach(projection.topLevelInteractions) { interaction in
                        if interaction.isPending,
                           let onResolveInteraction {
                            switch interaction.kind {
                            case "permission":
                                NativeLivePermissionInteractionCard(
                                    interaction: interaction,
                                    onResolve: onResolveInteraction
                                )
                            case "question":
                                NativeLiveQuestionInteractionCard(
                                    interaction: interaction,
                                    onResolve: onResolveInteraction
                                )
                            default:
                                NativeLiveInteractionHistoryRow(
                                    interaction: interaction
                                )
                            }
                        } else {
                            NativeLiveInteractionHistoryRow(
                                interaction: interaction
                            )
                        }
                    }
                }
                .padding(.top, 4)
            }
        }
        .sheet(isPresented: $isShowingMurmur) {
            if let text = normalizedMurmurText {
                NativeLiveMurmurSheet(text: text)
            }
        }
    }

    private var normalizedMurmurText: String? {
        guard let murmurText else { return nil }
        let value = murmurText.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return value.isEmpty ? nil : value
    }

    private var effectiveExpanded: Bool {
        !header.isEmpty && expansion.isActivityExpanded
    }

}
