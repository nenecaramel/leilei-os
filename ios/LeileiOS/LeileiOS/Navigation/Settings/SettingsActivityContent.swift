import SwiftUI

struct SettingsActivityContent: View {
    let dataService: any SettingsDataService

    @State private var loadState: ActivityLoadState = .loading

    var body: some View {
        Group {
            switch loadState {
            case .loading:
                ProgressView()
                    .frame(maxWidth: .infinity)
            case .unavailable(let message):
                SettingsDetailCard {
                    SettingsUnavailableState(message: message)
                }
            case .loaded(let records):
                if records.isEmpty {
                    SettingsDetailCard {
                        SettingsUnavailableState(message: "No Activity")
                    }
                } else {
                    ActivityGroups(records: records)
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

private struct ActivityGroups: View {
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
            records.first(where: { record in
                let day = calendar.startOfDay(for: record.timestamp)
                let key = day == startOfToday ? "Today" : day == startOfYesterday ? "Yesterday" : formatter.string(from: record.timestamp)
                return key == lhs.key
            })?.timestamp ?? .distantPast > records.first(where: { record in
                let day = calendar.startOfDay(for: record.timestamp)
                let key = day == startOfToday ? "Today" : day == startOfYesterday ? "Yesterday" : formatter.string(from: record.timestamp)
                return key == rhs.key
            })?.timestamp ?? .distantPast
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            ForEach(groupedRecords, id: \.0) { title, groupedRecords in
                SettingsSection(title: title) {
                    ForEach(Array(groupedRecords.enumerated()), id: \.element.id) { index, record in
                        SettingsActivityRow(record: record)
                        if index < groupedRecords.count - 1 {
                            SettingsDivider()
                        }
                    }
                }
            }
        }
    }
}

private struct SettingsActivityRow: View {
    let record: SettingsActivityRecord

    var body: some View {
        VStack(spacing: 4) {
            HStack {
                Text(record.label)
                    .font(.system(size: 17, weight: .medium))
                Spacer()
                Text(record.timestamp.formatted(date: .omitted, time: .shortened))
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(.secondary)
            }
            HStack {
                Text(record.source)
                Spacer()
                Text(record.result)
            }
            .font(.system(size: 15, weight: .regular))
            .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
    }
}
