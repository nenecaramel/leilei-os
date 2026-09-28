import SwiftUI

struct SettingsStatusContent: View {
    let dataService: any SettingsDataService

    @State private var status: SettingsRuntimeStatus?
    @State private var errorMessage: String?
    @State private var isLoading = true

    var body: some View {
        Form {
            Section("Status") {
                LabeledContent(
                    "Web API",
                    value: status?.webAPI
                        ?? (isLoading ? "Loading…" : "Unavailable")
                )
                LabeledContent(
                    "ChatGPT / Claude MCP",
                    value: status?.chatGPTClaudeMCP
                        ?? (isLoading ? "Loading…" : "Unavailable")
                )
                LabeledContent(
                    "Internal MCP",
                    value: status?.internalMCP
                        ?? (isLoading ? "Loading…" : "Unavailable")
                )
            }

            if errorMessage != nil {
                Section {
                    SettingsSectionState(
                        title: "Unavailable",
                        actionTitle: "Retry"
                    ) {
                        Task {
                            await loadStatus()
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Color.settingsBackground)
        .task {
            await loadStatus()
        }
    }

    @MainActor
    private func loadStatus() async {
        isLoading = true
        defer { isLoading = false }

        do {
            status = try await dataService.readRuntimeStatus()
            errorMessage = nil
        } catch {
            status = nil
            errorMessage = "Unavailable"
        }
    }
}
