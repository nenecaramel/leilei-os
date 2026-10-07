import SwiftUI

struct SettingsSummaryContent: View {
    let dataService: any SettingsDataService

    @State private var summary: SettingsDataSummary?
    @State private var isLoading = true

    var body: some View {
        Form {
            Section("Summary") {
                LabeledContent("Diary", value: diaryValue)
                LabeledContent("Diary comments", value: countValue(\.diaryComments))
                LabeledContent("Todo", value: countValue(\.todo))
                LabeledContent("Conversations", value: conversationsValue)
                LabeledContent("Mind", value: countValue(\.mind))
                LabeledContent("Universe", value: universeValue)
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Color.settingsBackground)
        .task {
            await loadSummary()
        }
    }

    private var diaryValue: String {
        if let summary {
            return "\(summary.diaryActive) active · \(summary.diaryArchived) archived"
        }
        return placeholder
    }

    private var conversationsValue: String {
        if let summary {
            return "\(summary.conversationsActive) active · \(summary.conversationsArchived) archived"
        }
        return placeholder
    }

    private var universeValue: String {
        if let summary {
            return "\(summary.universeNodes) nodes"
        }
        return placeholder
    }

    private var placeholder: String {
        isLoading ? "Loading…" : "Unavailable"
    }

    private func countValue(
        _ keyPath: KeyPath<SettingsDataSummary, Int>
    ) -> String {
        guard let summary else { return placeholder }
        return "\(summary[keyPath: keyPath])"
    }

    @MainActor
    private func loadSummary() async {
        isLoading = true
        defer { isLoading = false }

        do {
            summary = try await dataService.readDataSummary()
        } catch {
            summary = nil
        }
    }
}
