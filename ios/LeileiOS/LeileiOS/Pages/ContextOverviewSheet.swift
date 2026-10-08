import SwiftUI

struct ContextOverviewSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appModel: AppModel
    @State private var isCompacting = false
    @State private var compactError: String?
    @State private var hasLoadedRuntimeMetadata = false

    var body: some View {
        NavigationStack {
            Form {
                    ContextUsageSection(metadata: metadata)


                    Section("Manual Compact") {
                        Button {
                            Task {
                                await compactContext()
                            }
                        } label: {
                            HStack(spacing: 10) {
                                if isCompacting {
                                    ProgressView()
                                        .controlSize(.small)
                                }
                                Text(
                                    isCompacting
                                        ? "Compacting…"
                                        : "Compact Context"
                                )
                            }
                        }
                        .disabled(
                            isCompacting
                            || appModel.chatSendState != .idle
                            || appModel.activeNativeLiveConversationID == nil
                        )

                        Text(
                            "Compresses the current Claude context without changing canonical chat history."
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                        if let compactError {
                            Text(compactError)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    }

                    ContextEnvironmentSection(
                        metadata: metadata,
                        hasLoadedRuntimeMetadata: hasLoadedRuntimeMetadata
                    )


                    if let readbackError =
                        ContextOverviewFormat.normalized(
                            metadata?.execution?.readbackError
                        ) {
                        Section("Execution Readback") {
                            Text(readbackError)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Color.settingsBackground)
            .navigationTitle("Context")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .background(Color.settingsBackground)
        .task {
            hasLoadedRuntimeMetadata =
                await appModel.refreshActiveNativeLiveRuntimeMetadata()
        }
    }

    @MainActor
    private func compactContext() async {
        guard !isCompacting,
              let conversationID =
                appModel.activeNativeLiveConversationID else {
            return
        }

        isCompacting = true
        compactError = nil
        defer {
            isCompacting = false
        }

        do {
            var request =
                try await appModel.api.createNativeLiveManualCompact(
                    conversationID: conversationID
                )

            for _ in 0..<80 {
                switch request.status {
                case .completed:
                    await appModel
                        .refreshActiveNativeLiveRuntimeMetadata()
                    return

                case .failed, .stale, .expired:
                    compactError =
                        request.failureCode
                        ?? manualCompactStatusText(request.status)
                    return

                case .pending, .reserved:
                    try await Task.sleep(
                        for: .milliseconds(500)
                    )
                    request =
                        try await appModel.api.nativeLiveManualCompact(
                            requestID: request.id
                        )
                }
            }

            compactError = "Manual compact timed out."
        } catch {
            compactError = error.localizedDescription
        }
    }

    private func manualCompactStatusText(
        _ status: NativeLiveManualCompactStatus
    ) -> String {
        switch status {
        case .failed:
            return "Manual compact failed."
        case .stale:
            return "Conversation changed before compact could be saved."
        case .expired:
            return "Manual compact expired before the Mac runtime reserved it."
        case .pending, .reserved, .completed:
            return "Manual compact did not complete."
        }
    }

    private var metadata: NativeLiveRuntimeMetadata? {
        appModel.nativeLiveRuntimeMetadata
    }

}
