import SwiftUI

struct SettingsActivityContent: View {
    let dataService: any SettingsDataService

    @State private var loadState: ActivityLoadState = .loading

    var body: some View {
        Form {
            Section("Activity") {
                switch loadState {
                case .loading:
                    SettingsSectionState(
                        title: "Loading…",
                        isLoading: true
                    )

                case .unavailable:
                    SettingsSectionState(
                        title: "Unavailable",
                        actionTitle: "Retry"
                    ) {
                        Task {
                            await loadActivity()
                        }
                    }

                case .loaded(let records):
                    if records.isEmpty {
                        SettingsSectionState(
                            title: "Nothing here"
                        )
                    } else {
                        ForEach(records) { record in
                            SettingsActivityRow(record: record)
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Color.settingsBackground)
        .task {
            await loadActivity()
        }
    }

    @MainActor
    private func loadActivity() async {
        loadState = .loading

        do {
            loadState = .loaded(try await dataService.readActivity())
        } catch {
            loadState = .unavailable("Unavailable")
        }
    }
}

private enum ActivityLoadState {
    case loading
    case unavailable(String)
    case loaded([SettingsActivityRecord])
}

private struct SettingsActivityRow: View {
    let record: SettingsActivityRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(record.label)
                Spacer()
                Text(record.timestamp.formatted(date: .abbreviated, time: .shortened))
                    .foregroundStyle(.secondary)
            }

            HStack {
                Text(record.source)
                Spacer()
                Text(record.result)
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
    }
}
