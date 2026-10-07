import SwiftUI

struct ConversationList: View {
    let scope: ConversationListScope
    let conversations: [NativeLiveConversationSummary]
    let activeConversationID: UUID?
    let activeTurnInFlight: Bool
    let lifecycleMutationIDs: Set<String>
    let onOpen: (NativeLiveConversationSummary) async -> Void
    let onArchive: (NativeLiveConversationSummary) async -> Void
    let onRestore: (NativeLiveConversationSummary) async -> Void
    let onDelete: (NativeLiveConversationSummary) -> Void
    let onLoadMore: () async -> Void

    var body: some View {
        List(conversations) { conversation in
            HStack(alignment: .center, spacing: 10) {
                if scope == .active {
                    Button {
                        Task {
                            await onOpen(conversation)
                        }
                    } label: {
                        rowContent(conversation)
                    }
                    .buttonStyle(.plain)
                    .disabled(
                        lifecycleMutationIDs.contains(
                            conversation.id
                        )
                    )
                } else if let conversationID =
                            UUID(uuidString: conversation.id) {
                    NavigationLink {
                        ArchivedConversationView(
                            conversationID: conversationID,
                            title: conversation.title
                        )
                    } label: {
                        rowContent(conversation)
                    }
                    .disabled(
                        lifecycleMutationIDs.contains(
                            conversation.id
                        )
                    )
                } else {
                    rowContent(conversation)
                }

                Menu {
                    switch scope {
                    case .active:
                        Button("Archive") {
                            Task {
                                await onArchive(conversation)
                            }
                        }
                        .disabled(isMutationDisabled(conversation))

                    case .archived:
                        if conversation.claudeHandoffSessionId == nil {
                            Button("Restore") {
                                Task {
                                    await onRestore(conversation)
                                }
                            }
                            .disabled(isMutationDisabled(conversation))
                        }
                    }

                    Button(
                        "Delete",
                        role: .destructive
                    ) {
                        onDelete(conversation)
                    }
                    .disabled(isMutationDisabled(conversation))
                } label: {
                    if lifecycleMutationIDs.contains(conversation.id) {
                        ProgressView()
                            .controlSize(.small)
                            .frame(
                                width: 28,
                                height: 28
                            )
                    } else {
                        Image(systemName: "ellipsis")
                            .font(.system(
                                size: 16,
                                weight: .medium
                            ))
                            .frame(
                                width: 28,
                                height: 28
                            )
                    }
                }
                .accessibilityLabel(
                    "Conversation actions"
                )
            }
            .listRowBackground(Color(.systemBackground))
            .onAppear {
                guard conversation.id == conversations.last?.id else {
                    return
                }
                Task {
                    await onLoadMore()
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color(.systemBackground))
    }

    private func isMutationDisabled(
        _ conversation: NativeLiveConversationSummary
    ) -> Bool {
        if lifecycleMutationIDs.contains(conversation.id) {
            return true
        }

        guard scope == .active,
              activeTurnInFlight,
              let activeConversationID,
              let conversationID = UUID(uuidString: conversation.id) else {
            return false
        }

        return activeConversationID == conversationID
    }

    private func rowContent(
        _ conversation: NativeLiveConversationSummary
    ) -> some View {
        HStack(
            alignment: .center,
            spacing: 12
        ) {
            VStack(
                alignment: .leading,
                spacing: 4
            ) {
                Text(
                    displayTitle(
                        for: conversation
                    )
                )
                .font(.body)
                .foregroundStyle(.primary)
                .lineLimit(1)

                if let handoffSessionID =
                        conversation.claudeHandoffSessionId {
                    Text(
                        "Claude Code · "
                        + String(handoffSessionID.prefix(8))
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                } else if let subtitle =
                            lastMessageDateText(
                                for: conversation
                            ) {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .frame(
                maxWidth: .infinity,
                alignment: .leading
            )

            if isActive(conversation) {
                Image(systemName: "checkmark")
                    .font(.system(
                        size: 13,
                        weight: .semibold
                    ))
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(
                        "Current conversation"
                    )
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    private func displayTitle(
        for conversation: NativeLiveConversationSummary
    ) -> String {
        let title = conversation.title?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return title?.isEmpty == false ? title! : "New Conversation"
    }

    private func lastMessageDateText(
        for conversation: NativeLiveConversationSummary
    ) -> String? {
        guard let value = conversation.lastMessageAt else {
            return nil
        }

        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds
        ]

        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]

        guard let date = fractional.date(from: value)
            ?? standard.date(from: value) else {
            return nil
        }

        if Calendar.current.isDate(
            date,
            equalTo: .now,
            toGranularity: .year
        ) {
            return date.formatted(
                .dateTime
                    .month(.abbreviated)
                    .day()
            )
        }

        return date.formatted(
            .dateTime
                .month(.abbreviated)
                .day()
                .year()
        )
    }

    private func isActive(
        _ conversation: NativeLiveConversationSummary
    ) -> Bool {
        guard scope == .active,
              let activeConversationID,
              let conversationID = UUID(uuidString: conversation.id) else {
            return false
        }
        return activeConversationID == conversationID
    }
}

struct ConversationListSkeleton: View {
    var body: some View {
        List(0..<6, id: \.self) { index in
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(
                    cornerRadius: 6,
                    style: .continuous
                )
                .fill(Color.secondary.opacity(0.12))
                .frame(
                    width:
                        index.isMultiple(of: 2)
                            ? 190
                            : 240,
                    height: 17
                )

                RoundedRectangle(
                    cornerRadius: 5,
                    style: .continuous
                )
                .fill(Color.secondary.opacity(0.08))
                .frame(width: 76, height: 11)
            }
            .padding(.vertical, 6)
            .listRowBackground(Color(.systemBackground))
            .accessibilityHidden(true)
        }
        .listStyle(.plain)
        .scrollDisabled(true)
        .scrollContentBackground(.hidden)
        .background(Color(.systemBackground))
    }
}

