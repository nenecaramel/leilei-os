import SwiftUI

struct DiaryView: View {
    @EnvironmentObject private var appModel: AppModel

    @State private var query = ""
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
                if diaries.isEmpty {
                    ContentUnavailableView(
                        query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ? "No Diary Entries"
                            : "No Results",
                        systemImage: "book.closed"
                    )
                } else {
                    DiaryList(diaries: diaries)
                }
            }
        }
        .searchable(text: $query, prompt: "Search Diary")
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
}

private struct DiaryList: View {
    let diaries: [DiaryEntry]

    var body: some View {
        List {
            ForEach(DiaryMonthGroup.make(from: diaries)) { group in
                Section(group.title) {
                    ForEach(group.diaries) { diary in
                        NavigationLink {
                            DiaryDetailView(diary: diary)
                        } label: {
                            DiaryRow(diary: diary)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }
}

private struct DiaryRow: View {
    let diary: DiaryEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(diary.title)
                .font(.headline)
                .lineLimit(1)

            Text(diary.content)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            HStack(spacing: 6) {
                Text(DiaryDate.formatRow(diary.date))

                if let mood = diary.mood?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !mood.isEmpty {
                    Text("·")
                    Text(mood)
                }

                if !diary.tags.isEmpty {
                    Text("·")
                    Text(diary.tags.map { "#\($0)" }.joined(separator: " "))
                        .lineLimit(1)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
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
        guard let components = components(from: value),
              let date = date(from: components)
        else {
            return value
        }

        return date.formatted(.dateTime.month(.abbreviated).day())
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
