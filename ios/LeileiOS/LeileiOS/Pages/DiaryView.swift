import SwiftUI

struct DiaryView: View {
    @EnvironmentObject private var appModel: AppModel

    @State private var query = ""
    @State private var timeFilter: DiaryTimeFilter = .anyTime
    @State private var archivePresented = false
    @State private var customDateRangePresented = false
    @State private var customStartDate = DiaryTimeFilter.defaultStartDate
    @State private var customEndDate = Date.now
    @State private var draftCustomStartDate = DiaryTimeFilter.defaultStartDate
    @State private var draftCustomEndDate = Date.now
    @State private var state: DiaryLoadState = .loading

    var body: some View {
        Group {
            switch state {
            case .loading:
                ProgressView("Loading Diary…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

            case .authRequired(let message):
                ContentUnavailableView {
                    Label("Sign In Required", systemImage: "person.crop.circle.badge.exclamationmark")
                } description: {
                    Text(message)
                } actions: {
                    Button("Sign In Again") {
                        Task {
                            await reauthorizeAndReload()
                        }
                    }
                }

            case .unavailable(let message):
                ContentUnavailableView(
                    "Diary Unavailable",
                    systemImage: "book.closed",
                    description: Text(message)
                )

            case .loaded(let diaries):
                let visibleDiaries = filteredDiaries(diaries)
                if visibleDiaries.isEmpty {
                    ContentUnavailableView(
                        query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            && timeFilter == .anyTime
                            ? "No Diary Entries"
                            : "No Results",
                        systemImage: "book.closed"
                    )
                } else {
                    DiaryList(diaries: visibleDiaries)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .searchable(text: $query, prompt: "Search")
        .navigationDestination(isPresented: $archivePresented) {
            DiaryArchivePlaceholder()
        }
        .sheet(isPresented: $customDateRangePresented) {
            DiaryCustomDateRangeSheet(
                startDate: $draftCustomStartDate,
                endDate: $draftCustomEndDate
            ) {
                customStartDate = draftCustomStartDate
                customEndDate = draftCustomEndDate
                timeFilter = .custom
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Archive") {
                        archivePresented = true
                    }

                    Picker("Time", selection: timeSelection) {
                        Text("Any Time")
                            .tag(DiaryTimeFilter.anyTime)

                        Text("Custom")
                            .tag(DiaryTimeFilter.custom)
                    }
                    .pickerStyle(.menu)
                    .menuActionDismissBehavior(.disabled)
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 18, weight: .medium))
                }
                .accessibilityLabel("Diary options")
            }

            if #available(iOS 26.0, *) {
                DefaultToolbarItem(kind: .search, placement: .bottomBar)

                ToolbarSpacer(.fixed, placement: .bottomBar)

                ToolbarItem(placement: .bottomBar) {
                    Button {
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .accessibilityLabel("New Diary Entry")
                }
            }
        }
        .task(id: query) {
            do {
                try await Task.sleep(for: .milliseconds(250))
                try Task.checkCancellation()
                await loadDiary()
            } catch is CancellationError {
                return
            } catch {
                return
            }
        }
        .refreshable {
            await loadDiary()
        }
    }

    @MainActor
    private func loadDiary() async {
        state = .loading

        do {
            let response: DiaryListEnvelope = try await appModel.api.request(
                path: diaryPath(for: query)
            )
            state = .loaded(response.data.diaries)
        } catch LeileiAPIError.missingAccessToken {
            state = .authRequired("Sign in to view your Diary.")
        } catch LeileiAPIError.unauthorized {
            await appModel.refreshConnectivity()
            state = .authRequired("Your sign-in session needs to be renewed.")
        } catch {
            state = .unavailable(error.localizedDescription)
        }
    }

    @MainActor
    private func reauthorizeAndReload() async {
        state = .loading

        do {
            try await appModel.reauthorize()
            await loadDiary()
        } catch {
            state = .unavailable(error.localizedDescription)
        }
    }

    private func diaryPath(for query: String) -> String {
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return "/api/v1/diary" }

        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "q", value: normalized)
        ]
        return "/api/v1/diary?\(components.percentEncodedQuery ?? "")"
    }

    private var timeSelection: Binding<DiaryTimeFilter> {
        Binding(
            get: { timeFilter },
            set: { selection in
                switch selection {
                case .anyTime:
                    timeFilter = .anyTime
                case .custom:
                    draftCustomStartDate = customStartDate
                    draftCustomEndDate = customEndDate
                    customDateRangePresented = true
                }
            }
        )
    }

    private func filteredDiaries(_ diaries: [DiaryEntry]) -> [DiaryEntry] {
        guard timeFilter == .custom else { return diaries }

        let dateFrom = DiaryDate.apiDate(customStartDate)
        let dateTo = DiaryDate.apiDate(customEndDate)

        return diaries.filter { diary in
            diary.date >= dateFrom && diary.date <= dateTo
        }
    }
}

private enum DiaryTimeFilter {
    case anyTime
    case custom

    static var defaultStartDate: Date {
        Calendar.current.date(byAdding: .month, value: -1, to: .now) ?? .now
    }
}

private struct DiaryCustomDateRangeSheet: View {
    @Binding var startDate: Date
    @Binding var endDate: Date

    let onApply: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                DatePicker(
                    "Start",
                    selection: $startDate,
                    in: ...endDate,
                    displayedComponents: .date
                )
                .datePickerStyle(.compact)

                DatePicker(
                    "End",
                    selection: $endDate,
                    in: startDate...,
                    displayedComponents: .date
                )
                .datePickerStyle(.compact)
            }
            .navigationTitle("Custom Range")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        onApply()
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

private struct DiaryArchivePlaceholder: View {
    var body: some View {
        Color(.systemBackground)
            .ignoresSafeArea()
            .navigationTitle("Archive")
            .navigationBarTitleDisplayMode(.inline)
    }
}

private struct DiaryList: View {
    let diaries: [DiaryEntry]

    var body: some View {
        List {
            ForEach(DiaryMonthGroup.make(from: diaries)) { group in
                Section(group.title) {
                    ForEach(group.diaries) { diary in
                        DiaryRow(diary: diary)
                            .listRowBackground(Color(.systemBackground))
                            .listRowSeparator(.visible)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color(.systemBackground))
    }
}

private struct DiaryRow: View {
    let diary: DiaryEntry

    private var metadataText: String {
        var parts: [String] = []

        if let mood = diary.mood?.trimmingCharacters(in: .whitespacesAndNewlines),
           !mood.isEmpty {
            parts.append(mood)
        }

        if !diary.tags.isEmpty {
            parts.append(diary.tags.map { "#\($0)" }.joined(separator: " "))
        }

        return parts.joined(separator: "  ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(diary.title)
                .font(.body.weight(.semibold))
                .lineLimit(1)

            HStack(spacing: 12) {
                Text(DiaryDate.formatRow(diary.date))
                    .fixedSize(horizontal: true, vertical: false)

                Spacer(minLength: 8)

                if !metadataText.isEmpty {
                    Text(metadataText)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}

private struct DiaryDetailView: View {
    let diary: DiaryEntry

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(DiaryDate.formatDetail(diary.date))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Text(diary.title)
                    .font(.title2.weight(.semibold))
                    .textSelection(.enabled)

                Text(diary.content)
                    .font(.body)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if diary.mood != nil || !diary.tags.isEmpty || diary.author != nil {
                    Divider()
                        .padding(.top, 4)

                    DiaryMetadata(diary: diary)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Diary")
        .navigationBarTitleDisplayMode(.inline)
        .background(Color(.systemBackground))
    }
}

private struct DiaryMetadata: View {
    let diary: DiaryEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let mood = diary.mood?.trimmingCharacters(in: .whitespacesAndNewlines),
               !mood.isEmpty {
                LabeledContent("Mood", value: mood)
            }

            if !diary.tags.isEmpty {
                LabeledContent(
                    "Tags",
                    value: diary.tags.map { "#\($0)" }.joined(separator: " ")
                )
            }

            if let author = diary.author {
                LabeledContent("Author", value: author)
            }
        }
        .font(.subheadline)
    }
}

private enum DiaryLoadState {
    case loading
    case authRequired(String)
    case unavailable(String)
    case loaded([DiaryEntry])
}

private struct DiaryListEnvelope: Decodable {
    let success: Bool
    let data: DiaryListData
}

private struct DiaryListData: Decodable {
    let diaries: [DiaryEntry]
    let metadata: DiaryListMetadata
}

private struct DiaryListMetadata: Decodable {
    let count: Int
}

private struct DiaryEntry: Decodable, Identifiable {
    let id: String
    let title: String
    let content: String
    let date: String
    let tags: [String]
    let mood: String?
    let createdAt: String
    let updatedAt: String
    let author: String?

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case content
        case date
        case tags
        case mood
        case author
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

private struct DiaryMonthGroup: Identifiable {
    let id: String
    let title: String
    let diaries: [DiaryEntry]

    static func make(from diaries: [DiaryEntry]) -> [DiaryMonthGroup] {
        var order: [String] = []
        var grouped: [String: [DiaryEntry]] = [:]

        for diary in diaries {
            let key = DiaryDate.monthKey(diary.date)
            if grouped[key] == nil {
                order.append(key)
                grouped[key] = []
            }
            grouped[key, default: []].append(diary)
        }

        return order.map { key in
            DiaryMonthGroup(
                id: key,
                title: DiaryDate.formatMonth(key),
                diaries: grouped[key] ?? []
            )
        }
    }
}

private enum DiaryDate {
    static func monthKey(_ value: String) -> String {
        guard let components = components(from: value) else {
            return "unknown:\(value)"
        }

        return String(format: "%04d-%02d", components.year, components.month)
    }

    static func formatMonth(_ key: String) -> String {
        guard !key.hasPrefix("unknown:"),
              let components = components(from: "\(key)-01"),
              let date = date(from: components)
        else {
            return "Unknown Date"
        }

        return date.formatted(.dateTime.month(.wide).year())
    }

    static func formatRow(_ value: String) -> String {
        guard let components = components(from: value) else {
            return value
        }

        return "\(components.month)/\(components.day)"
    }

    static func apiDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    static func formatDetail(_ value: String) -> String {
        guard let components = components(from: value),
              let date = date(from: components)
        else {
            return value
        }

        return date.formatted(.dateTime.year().month(.wide).day())
    }

    private static func components(from value: String) -> (year: Int, month: Int, day: Int)? {
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3,
              let year = Int(parts[0]),
              let month = Int(parts[1]),
              let day = Int(parts[2]),
              (1...12).contains(month),
              (1...31).contains(day)
        else {
            return nil
        }

        return (year, month, day)
    }

    private static func date(from components: (year: Int, month: Int, day: Int)) -> Date? {
        Calendar(identifier: .gregorian).date(
            from: DateComponents(
                year: components.year,
                month: components.month,
                day: components.day
            )
        )
    }
}
