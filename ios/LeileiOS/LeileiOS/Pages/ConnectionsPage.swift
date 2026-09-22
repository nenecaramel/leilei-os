import SwiftUI

struct ConnectionsPage: View {
    @EnvironmentObject private var appModel: AppModel

    var body: some View {
        List {
            Section("Backend") {
                LabeledContent("API") {
                    Text(appModel.backendState.label)
                        .foregroundStyle(stateColor(appModel.backendState))
                }

                LabeledContent("Base URL") {
                    Text(appModel.config.apiBaseURL.host ?? appModel.config.apiBaseURL.absoluteString)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.trailing)
                }
            }

            Section("Account") {
                LabeledContent("Web API session") {
                    Text(appModel.sessionState.label)
                        .foregroundStyle(stateColor(appModel.sessionState))
                }

                LabeledContent("Native Auth0 config") {
                    Text(appModel.config.isNativeAuthConfigured ? "Configured" : "Not configured")
                        .foregroundStyle(
                            appModel.config.isNativeAuthConfigured ? .primary : .secondary
                        )
                }
            }

            Section {
                Button("Check Connections") {
                    Task {
                        await appModel.refreshConnectivity()
                    }
                }
            } footer: {
                Text(
                    "The iOS app talks only to the LeileiOS backend. It never connects directly to PostgreSQL or Claude Code."
                )
            }
        }
        .task {
            await appModel.refreshConnectivity()
        }
    }

    private func stateColor(_ state: AppModel.ProbeState) -> Color {
        switch state {
        case .reachable:
            return .primary
        case .unavailable:
            return .secondary
        case .idle, .checking:
            return .secondary
        }
    }
}
