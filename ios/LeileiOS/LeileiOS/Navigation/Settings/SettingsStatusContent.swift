import SwiftUI

struct SettingsStatusContent: View {
    let dataService: any SettingsDataService

    @State private var status: SettingsRuntimeStatus?

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            SettingsDetailCard {
                SettingsDetailValueRow(title: "Web API", value: status?.webAPI ?? "Unavailable")
                SettingsDivider()
                SettingsDetailValueRow(title: "ChatGPT / Claude MCP", value: status?.chatGPTClaudeMCP ?? "Unavailable")
                SettingsDivider()
                SettingsDetailValueRow(title: "Internal MCP", value: status?.internalMCP ?? "Unavailable")
            }
        }
        .task {
            do {
                status = try await dataService.readRuntimeStatus()
            } catch {
                status = nil
            }
        }
    }
}
