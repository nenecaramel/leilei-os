import SwiftUI

struct SettingsActivityContent: View {
    let dataService: any SettingsDataService

    @State private var loadState: ActivityLoadState = .loading

    var body: some View {
        Group {
            switch loadState {
            case .loading:
                ProgressView("Loading Activity…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.settingsBackground)
            case .unavailable(let message):
                ContentUnavailableView(
                    "Activity Unavailable",
                    systemImage: "clock.arrow.circlepath",
                    description: Text(message)
                )
                .background(Color.settingsBackground)
            case .loaded(let records):
                if records.isEmpty {
                    ContentUnavailableView(
                        "No Activity",
                        systemImage: "clock.arrow.circlepath"
                    )
                    .background(Color.settingsBackground)
                } else {
                    ActivityList(records: records)
                }
            }
        }
        .task {
            do {
                loadState = .loaded(try await dataService.readActivity())
            } catch {
                loadState = .unavailable(error.localizedDescription)
            }
        }
    }
}

private enum ActivityLoadState {
    case loading
    case unavailable(String)
    case loaded([SettingsActivityRecord])
}

private struct ActivityList: View {
    let records: [SettingsActivityRecord]

    private var groupedRecords: [(String, [SettingsActivityRecord])] {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: .now)
        let startOfYesterday = calendar.date(byAdding: .day, value: -1, to: startOfToday)!
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"

        return Dictionary(grouping: records) { record in
            let day = calendar.startOfDay(for: record.timestamp)
            if day == startOfToday { return "Today" }
            if day == startOfYesterday { return "Yesterday" }
            return formatter.string(from: record.timestamp)
        }
        .sorted { lhs, rhs in
            let left = lhs.value.map(\.timestamp).max() ?? .distantPast
            let right = rhs.value.map(\.timestamp).max() ?? .distantPast
            return left > right
        }
    }

    var body: some View {
        List {
            ForEach(groupedRecords, id: \.0) { title, groupedRecords in
                Section(title) {
                    ForEach(groupedRecords) { record in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(record.label)
                                Spacer()
                                Text(
                                    record.timestamp.formatted(
                                        date: .omitted,
                                        time: .shortened
                                    )
                                )
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
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.settingsBackground)
    }
}
