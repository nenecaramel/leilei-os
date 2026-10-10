import SwiftUI
import UniformTypeIdentifiers

struct ClaudeSessionForkSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    let onCreated: () -> Void

    @State private var requestID: String?
    @State private var sessions: [NativeLiveExternalClaudeSession] = []
    @State private var isLoading = true
    @State private var forkingSessionID: String?
    @State private var errorMessage: String?
    @State private var historyUpload:
        NativeLiveConversationHistoryUpload?
    @State private var isHistoryImporterPresented = false
    @State private var historyImportError: String?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading Claude sessions…")
                        .frame(
                            maxWidth: .infinity,
                            maxHeight: .infinity
                        )
                } else if let errorMessage {
                    AppStateSurface(
                        title: errorMessage,
                        actionTitle: "Retry"
                    ) {
                        Task {
                            await loadSessions()
                        }
                    }
                } else if sessions.isEmpty {
                    AppStateSurface(
                        title: "No Claude Code sessions"
                    )
                } else {
                    List(sessions) { session in
                        Button {
                            Task {
                                await fork(session)
                            }
                        } label: {
                            HStack(spacing: 12) {
                                VStack(
                                    alignment: .leading,
                                    spacing: 4
                                ) {
                                    Text(displayTitle(session))
                                        .foregroundStyle(.primary)
                                        .lineLimit(2)

                                    Text(detailText(session))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }

                                Spacer()

                                if forkingSessionID == session.sessionId {
                                    ProgressView()
                                        .controlSize(.small)
                                } else {
                                    Image(
                                        systemName:
                                            "arrow.triangle.branch"
                                    )
                                    .foregroundStyle(.secondary)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(forkingSessionID != nil)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Claude Sessions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(forkingSessionID != nil)
                }

                ToolbarItem(placement: .primaryAction) {
                    Button {
                        isHistoryImporterPresented = true
                    } label: {
                        Label(
                            historyUpload.map {
                                "History \($0.messages.count)"
                            } ?? "History",
                            systemImage:
                                historyUpload == nil
                                ? "doc.badge.plus"
                                : "doc.badge.checkmark"
                        )
                    }
                    .disabled(forkingSessionID != nil)
                    .accessibilityLabel(
                        historyUpload == nil
                        ? "Attach Claude history"
                        : "Replace attached Claude history"
                    )
                }
            }
        }
        .presentationDetents([.medium, .large])
        .task {
            await loadSessions()
        }
        .fileImporter(
            isPresented: $isHistoryImporterPresented,
            allowedContentTypes: [.json, .plainText, .data],
            allowsMultipleSelection: false
        ) { result in
            importHistory(result)
        }
        .appFailureAlert(
            message: historyImportError ?? "The history could not be imported.",
            isPresented: Binding(
                get: { historyImportError != nil },
                set: { visible in
                    if !visible {
                        historyImportError = nil
                    }
                }
            )
        )
    }

    @MainActor
    private func loadSessions() async {
        guard forkingSessionID == nil else { return }

        isLoading = true
        errorMessage = nil
        sessions = []
        requestID = nil

        do {
            var request =
                try await appModel.api
                    .createNativeLiveExternalSessionRequest()

            for _ in 0..<60 {
                switch request.status {
                case .completed:
                    requestID = request.id
                    sessions = request.sessions
                    isLoading = false
                    return

                case .failed, .expired:
                    errorMessage =
                        request.failureCode
                        ?? "Claude session listing failed."
                    isLoading = false
                    return

                case .pending, .reserved:
                    try await Task.sleep(
                        for: .milliseconds(500)
                    )
                    request =
                        try await appModel.api
                            .nativeLiveExternalSessionRequest(
                                requestID: request.id
                            )
                }
            }

            errorMessage = "Claude session listing timed out."
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    @MainActor
    private func fork(
        _ session: NativeLiveExternalClaudeSession
    ) async {
        guard let requestID,
              forkingSessionID == nil else {
            return
        }

        forkingSessionID = session.sessionId
        errorMessage = nil

        do {
            _ = try await appModel
                .createNativeLiveConversationFromClaudeSession(
                    requestID: requestID,
                    sourceSessionID: session.sessionId,
                    historySnapshot: historyUpload
                )
            onCreated()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            forkingSessionID = nil
        }
    }

    private func displayTitle(
        _ session: NativeLiveExternalClaudeSession
    ) -> String {
        for candidate in [
            session.customTitle,
            session.summary,
            session.firstPrompt
        ] {
            let normalized = candidate?
                .trimmingCharacters(
                    in: .whitespacesAndNewlines
                )
            if let normalized, !normalized.isEmpty {
                return normalized
            }
        }
        return "Claude Session"
    }

    private func detailText(
        _ session: NativeLiveExternalClaudeSession
    ) -> String {
        let directoryName = URL(
            fileURLWithPath: session.workingDirectory
        ).lastPathComponent
        let branch = session.gitBranch?
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )

        let shortID = String(session.sessionId.prefix(8))
        if let branch, !branch.isEmpty {
            return directoryName + " · " + branch + " · " + shortID
        }
        return directoryName + " · " + shortID
    }

    private func importHistory(
        _ result: Result<[URL], Error>
    ) {
        do {
            guard let url = try result.get().first else {
                return
            }

            let scoped = url.startAccessingSecurityScopedResource()
            defer {
                if scoped {
                    url.stopAccessingSecurityScopedResource()
                }
            }

            let data = try Data(contentsOf: url)
            guard data.count <= 900_000,
                  let text = String(data: data, encoding: .utf8) else {
                throw ClaudeHistoryImportError.invalidFile
            }

            let decoder = JSONDecoder()
            var messages: [NativeLiveConversationHistoryInputMessage] = []
            var totalCharacters = 0

            for line in text.split(
                whereSeparator: { $0.isNewline }
            ) {
                let message = try decoder.decode(
                    NativeLiveConversationHistoryInputMessage.self,
                    from: Data(line.utf8)
                )
                guard
                    message.role == "user"
                        || message.role == "assistant",
                    !message.time.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    ).isEmpty,
                    !message.content.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    ).isEmpty,
                    message.content.count <= 100_000
                else {
                    throw ClaudeHistoryImportError.invalidFile
                }

                totalCharacters += message.content.count
                guard messages.count < 5_000,
                      totalCharacters <= 700_000 else {
                    throw ClaudeHistoryImportError.tooLarge
                }
                messages.append(message)
            }

            guard !messages.isEmpty else {
                throw ClaudeHistoryImportError.invalidFile
            }

            historyUpload = NativeLiveConversationHistoryUpload(
                sourceLabel: url.lastPathComponent,
                timeZone: "Asia/Shanghai",
                messages: messages
            )
            historyImportError = nil
        } catch {
            historyUpload = nil
            historyImportError = error.localizedDescription
        }
    }
}

private enum ClaudeHistoryImportError: LocalizedError {
    case invalidFile
    case tooLarge

    var errorDescription: String? {
        switch self {
        case .invalidFile:
            return "Choose the main-branch JSONL with role, time, and content on every line."
        case .tooLarge:
            return "History must contain at most 5,000 messages and 700,000 characters."
        }
    }
}
