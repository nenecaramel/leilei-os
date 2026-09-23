import SwiftUI

struct SettingsStatusContent: View {
    let dataService: any SettingsDataService

    @State private var status: SettingsRuntimeStatus?
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section("Status") {
                LabeledContent("Web API", value: status?.webAPI ?? "Unavailable")
                LabeledContent(
                    "ChatGPT / Claude MCP",
                    value: status?.chatGPTClaudeMCP ?? "Unavailable"
                )
                LabeledContent("Internal MCP", value: status?.internalMCP ?? "Unavailable")
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Color.settingsBackground)
        .task {
            do {
                status = try await dataService.readRuntimeStatus()
                errorMessage = nil
            } catch {
                status = nil
                errorMessage = error.localizedDescription
            }
        }
    }
}
