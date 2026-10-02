import SwiftUI
import Foundation

struct NativeLiveRuntimeAssistantRow: View {
    let runtimeSurface: NativeLiveRuntimeSurfaceState?
    let onResolveInteraction:
        (
            NativeLiveRuntimeInteractionSnapshot,
            [String: NativeLiveJSONValue]
        ) async throws -> Void

    var body: some View {
        let text = runtimeSurface?.streamingText
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )
        let activity = runtimeSurface?.activityText
        let pendingInteraction =
            runtimeSurface?.interactions.first {
                $0.isPending
            }

        VStack(alignment: .leading, spacing: 12) {
            if let text,
               !text.isEmpty {
                ChatMarkdownView(
                    text: text,
                    fillsAvailableWidth: true,
                    lineSpacing: 6,
                    paragraphSpacing: 22
                )
            }

            if let activity,
               !activity.isEmpty {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)

                    Text(activity)
                        .font(.system(
                            size: 13.5,
                            weight: .regular
                        ))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                .transition(.opacity)
            }

            if let runtimeSurface {
                let toolUses = runtimeSurface.events.filter {
                    $0.event.type == "tool_use"
                }
                ForEach(toolUses) { toolUse in
                    NativeLiveRuntimeToolCallRow(
                        toolUse: toolUse,
                        events: runtimeSurface.events
                    )
                }
            }

            if let pendingInteraction {
                switch pendingInteraction.kind {
                case "permission":
                    NativeLivePermissionInteractionCard(
                        interaction: pendingInteraction,
                        onResolve: onResolveInteraction
                    )
                    .id(pendingInteraction.interactionID)

                case "question":
                    NativeLiveQuestionInteractionCard(
                        interaction: pendingInteraction,
                        onResolve: onResolveInteraction
                    )
                    .id(pendingInteraction.interactionID)

                default:
                    EmptyView()
                }
            }

            if (text?.isEmpty ?? true)
                && activity == nil
                && pendingInteraction == nil {
                AssistantTypingIndicatorRow()
            }
        }
        .frame(
            maxWidth: .infinity,
            alignment: .leading
        )
    }
}

struct AssistantTypingIndicatorRow: View {
    var body: some View {
        TimelineView(
            .animation(minimumInterval: 0.18)
        ) { context in
            let phase = Int(
                context.date.timeIntervalSinceReferenceDate / 0.18
            ) % 3

            HStack(spacing: 5) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(
                            Color.secondary.opacity(
                                phase == index ? 0.82 : 0.24
                            )
                        )
                        .frame(width: 5, height: 5)
                        .scaleEffect(
                            phase == index ? 1.08 : 0.92
                        )
                }
            }
            .frame(height: 22)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct NativeLiveRuntimeToolCallRow: View {
    let toolUse: NativeLiveRuntimeEventSnapshot
    let events: [NativeLiveRuntimeEventSnapshot]

    private var toolUseID: String? {
        toolUse.event.payload?["tool_use_id"]?.stringValue
    }

    private var result: NativeLiveRuntimeEventSnapshot? {
        guard let toolUseID else { return nil }
        return events.last(where: { event in
            event.event.type == "tool_result"
                && event.event.payload?["tool_use_id"]?.stringValue
                    == toolUseID
        })
    }

    var body: some View {
        NativeLiveToolCallCard(
            toolName:
                toolUse.event.payload?["display_name"]?.stringValue
                ?? toolUse.event.payload?["tool_name"]?.stringValue
                ?? "Tool",
            detail: nativeLiveJSONDetail(
                toolUse.event.payload?["input"]
            ),
            state:
                result == nil
                    ? .running
                    : (
                        result?.event.payload?["is_error"]?.boolValue
                            == true
                        ? .failed
                        : .completed
                    )
        )
    }
}


enum NativeLiveToolCallState {
    case running
    case completed
    case failed
}


struct NativeLiveToolCallCard: View {
    let toolName: String
    let detail: String?
    let state: NativeLiveToolCallState

    @State private var isShowingDetails = false

    var body: some View {
        Button {
            isShowingDetails = true
        } label: {
            HStack(spacing: 8) {
                switch state {
                case .running:
                    ProgressView()
                        .controlSize(.small)
                case .completed:
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                case .failed:
                    Image(systemName: "exclamationmark.circle")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }

                Text(nativeLiveToolDisplayName(toolName))
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                Spacer(minLength: 8)

                Text(stateLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Image(systemName: "chevron.right")
                    .font(.system(
                        size: 10.5,
                        weight: .semibold
                    ))
                    .foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 11)
        .padding(.vertical, 9)
        .background(
            Color.primary.opacity(0.045),
            in: RoundedRectangle(
                cornerRadius: 11,
                style: .continuous
            )
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .sheet(isPresented: $isShowingDetails) {
            NativeLiveToolDetailSheet(
                title: nativeLiveToolDisplayName(toolName),
                status: stateLabel,
                sectionTitle: "Input",
                detail: detail
            )
        }
    }

    private var stateLabel: String {
        switch state {
        case .running:
            return "Running"
        case .completed:
            return "Done"
        case .failed:
            return "Failed"
        }
    }
}


struct NativeLiveToolResultCard: View {
    let isError: Bool
    let detail: String?

    @State private var isShowingDetails = false

    var body: some View {
        Button {
            isShowingDetails = true
        } label: {
            HStack(spacing: 8) {
                Image(
                    systemName:
                        isError
                        ? "exclamationmark.circle"
                        : "checkmark.circle"
                )
                .font(.system(size: 13))
                .foregroundStyle(.secondary)

                Text(isError ? "Tool failed" : "Tool result")
                    .font(.system(
                        size: 13.5,
                        weight: .medium
                    ))
                    .foregroundStyle(.secondary)

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.system(
                        size: 10.5,
                        weight: .semibold
                    ))
                    .foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.leading, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .sheet(isPresented: $isShowingDetails) {
            NativeLiveToolDetailSheet(
                title: isError ? "Tool failed" : "Tool result",
                status: isError ? "Failed" : "Done",
                sectionTitle: "Output",
                detail: detail
            )
        }
    }
}


private struct NativeLiveToolDetailSheet: View {
    @Environment(\.dismiss) private var dismiss

    let title: String
    let status: String
    let sectionTitle: String
    let detail: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        Text(status)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        Spacer()
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text(sectionTitle)
                            .font(.headline)

                        if let detail,
                           !detail.isEmpty {
                            Text(detail)
                                .font(.system(
                                    size: 13,
                                    design: .monospaced
                                ))
                                .foregroundStyle(.primary)
                                .textSelection(.enabled)
                                .fixedSize(
                                    horizontal: false,
                                    vertical: true
                                )
                                .frame(
                                    maxWidth: .infinity,
                                    alignment: .leading
                                )
                        } else {
                            Text("No details")
                                .font(.body)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 36)
            }
            .background(Color(.systemBackground))
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([
            .medium,
            .large
        ])
        .presentationDragIndicator(.visible)
        .presentationBackground(
            Color(.systemBackground)
        )
    }
}


private func nativeLiveToolDisplayName(
    _ raw: String
) -> String {
    let prefix = "mcp__leileios__"
    guard raw.hasPrefix(prefix) else {
        return raw
    }
    return "LeileiOS · " + String(raw.dropFirst(prefix.count))
}


func nativeLiveJSONDetail(
    _ value: NativeLiveJSONValue?
) -> String? {
    guard let value else { return nil }
    let rendered = nativeLiveJSONDescription(value)
    let normalized = rendered.trimmingCharacters(
        in: .whitespacesAndNewlines
    )
    return normalized.isEmpty ? nil : normalized
}


private func nativeLiveJSONDescription(
    _ value: NativeLiveJSONValue
) -> String {
    switch value {
    case .string(let string):
        return string
    case .number(let number):
        return String(number)
    case .bool(let bool):
        return bool ? "true" : "false"
    case .null:
        return "null"
    case .array(let values):
        return "["
            + values.map(nativeLiveJSONDescription)
                .joined(separator: ", ")
            + "]"
    case .object(let object):
        return "{"
            + object.keys.sorted().map { key in
                let value = object[key] ?? .null
                return key
                    + ": "
                    + nativeLiveJSONDescription(value)
            }
            .joined(separator: ", ")
            + "}"
    }
}
