import SwiftUI

struct DiaryView: View {
    @EnvironmentObject private var appModel: AppModel

    @State private var query = ""
    @State private var timeFilter: DiaryTimeFilter = .anyTime
    @State private var archivePresented = false
    @State private var createPresented = false
    @State private var customDateRangePresented = false
    @State private var customStartDate = DiaryTimeFilter.defaultStartDate
    @State private var customEndDate = Date.now
    @State private var draftCustomStartDate = DiaryTimeFilter.defaultStartDate
    @State private var draftCustomEndDate = Date.now
    @State private var diaryCount: Int?
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
        .navigationDestination(isPresented: $createPresented) {
            DiaryCreateView {
                Task {
                    await loadDiary()
                }
            }
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
            ToolbarItem(placement: .principal) {
                DiaryNavigationTitle(
                    title: "Diary",
                    count: diaryCount
                )
            }

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
                        createPresented = true
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
            if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                diaryCount = response.data.metadata.count
            }
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
    @EnvironmentObject private var appModel: AppModel
    @State private var diaryCount: Int?

    var body: some View {
        Color(.systemBackground)
            .ignoresSafeArea()
            .navigationTitle("Archive")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    DiaryNavigationTitle(
                        title: "Archive",
                        count: diaryCount
                    )
                }
            }
            .task {
                await loadCount()
            }
    }

    @MainActor
    private func loadCount() async {
        do {
            let response: DiaryListEnvelope = try await appModel.api.request(
                path: "/api/v1/diary/archived"
            )
            diaryCount = response.data.metadata.count
        } catch {
            diaryCount = nil
        }
    }
}

private struct DiaryNavigationTitle: View {
    let title: String
    let count: Int?

    var body: some View {
        if let count {
            HStack(spacing: 6) {
                Text("\(count)")
                    .font(.system(size: 12, weight: .regular))
                    .hidden()

                Text(title)
                    .font(.headline)

                Text("\(count)")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(.secondary)
            }
            .fixedSize()
        } else {
            Text(title)
                .font(.headline)
        }
    }
}

private struct DiaryList: View {
    let diaries: [DiaryEntry]

    var body: some View {
        List {
            ForEach(DiaryMonthGroup.make(from: diaries)) { group in
                Section(group.title) {
                    ForEach(Array(group.diaries.enumerated()), id: \.element.id) { index, diary in
                        NavigationLink {
                            DiaryDetailView(diaryID: diary.id)
                        } label: {
                            DiaryRow(diary: diary)
                        }
                        .listRowBackground(Color(.systemBackground))
                        .listRowSeparator(index == 0 ? .hidden : .visible, edges: .top)
                        .listRowSeparator(
                            index == group.diaries.count - 1 ? .hidden : .visible,
                            edges: .bottom
                        )
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
    let diaryID: String

    @EnvironmentObject private var appModel: AppModel
    @State private var state: DiaryDetailLoadState = .loading
    @State private var commentText = ""
    @State private var commentAuthor = "L"
    @State private var isSavingComment = false
    @State private var commentError: String?

    var body: some View {
        Group {
            switch state {
            case .loading:
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

            case .unavailable(let message):
                ContentUnavailableView(
                    "Diary Unavailable",
                    systemImage: "book.closed",
                    description: Text(message)
                )

            case .loaded(let diary):
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(DiaryDate.formatDetail(diary.date))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.bottom, 18)

                        Text(diary.title)
                            .font(.title2.weight(.semibold))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        if let content = diary.content, !content.isEmpty {
                            Text(content)
                                .font(.body)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.top, 12)
                        }

                        if diary.mood != nil || !diary.tags.isEmpty || diary.author != nil {
                            DiaryMetadata(diary: diary)
                                .padding(.top, 18)
                        }

                        DiaryCommentsSection(
                            comments: diary.comments ?? [],
                            count: diary.commentsMetadata?.count ?? diary.comments?.count ?? 0,
                            commentText: $commentText,
                            commentAuthor: $commentAuthor,
                            isSaving: isSavingComment,
                            errorMessage: commentError,
                            onSend: {
                                Task {
                                    await addComment()
                                }
                            }
                        )
                        .padding(.top, 28)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 14)
                    .padding(.bottom, 32)
                }
                .background(Color(.systemBackground))
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: diaryID) {
            await loadDetail()
        }
    }

    @MainActor
    private func loadDetail() async {
        state = .loading

        do {
            let response: DiaryEntryEnvelope = try await appModel.api.request(
                path: "/api/v1/diary/\(diaryID)"
            )
            state = .loaded(response.data)
        } catch {
            state = .unavailable(error.localizedDescription)
        }
    }

    @MainActor
    private func addComment() async {
        let content = commentText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty, !isSavingComment else { return }

        isSavingComment = true
        commentError = nil
        defer { isSavingComment = false }

        do {
            let payload = DiaryCommentCreateRequest(
                author: commentAuthor,
                content: content,
                idempotencyKey: "ios:diary-comment:\(UUID().uuidString)"
            )
            let body = try JSONEncoder().encode(payload)
            let response: DiaryCommentCreateEnvelope = try await appModel.api.request(
                path: "/api/v1/diary/\(diaryID)/comments",
                method: "POST",
                body: body
            )

            commentText = ""

            guard case .loaded(var diary) = state else { return }
            var comments = diary.comments ?? []
            let wasAlreadyVisible = comments.contains {
                $0.id == response.data.comment.id
            }
            if !wasAlreadyVisible {
                comments.append(response.data.comment)
            }
            comments.sort {
                if $0.createdAt == $1.createdAt {
                    return $0.id < $1.id
                }
                return $0.createdAt < $1.createdAt
            }
            diary.comments = comments
            let existingCount = diary.commentsMetadata?.count
                ?? max(0, comments.count - (wasAlreadyVisible ? 0 : 1))
            diary.commentsMetadata = DiaryCommentsMetadata(
                count: existingCount + (wasAlreadyVisible ? 0 : 1),
                returned: comments.count,
                truncated: diary.commentsMetadata?.truncated ?? false
            )
            state = .loaded(diary)
        } catch {
            commentError = error.localizedDescription
        }
    }
}

private struct DiaryCommentsSection: View {
    let comments: [DiaryComment]
    let count: Int
    @Binding var commentText: String
    @Binding var commentAuthor: String
    let isSaving: Bool
    let errorMessage: String?
    let onSend: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Divider()

            HStack(spacing: 6) {
                Text("Comments")
                    .font(.headline)

                Text("\(count)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(comments) { comment in
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 5) {
                        Text(comment.author)
                            .font(.caption.weight(.medium))

                        Text("·")
                            .foregroundStyle(.tertiary)

                        Text(DiaryCommentDate.format(comment.createdAt))
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        if comment.updatedAt != comment.createdAt {
                            Text("Edited")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                    }

                    Text(comment.content)
                        .font(.body)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                .padding(.vertical, 3)
            }

            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    ForEach(["L", "G", "C"], id: \.self) { author in
                        Button(author) {
                            commentAuthor = author
                        }
                    }
                } label: {
                    Text(commentAuthor)
                        .font(.caption.weight(.semibold))
                        .frame(width: 28, height: 28)
                        .background(.thinMaterial, in: Circle())
                }

                TextField("Add a comment...", text: $commentText, axis: .vertical)
                    .lineLimit(1...5)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 16))

                Button(action: onSend) {
                    if isSaving {
                        ProgressView()
                            .frame(width: 28, height: 28)
                    } else {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 27))
                    }
                }
                .disabled(
                    isSaving ||
                    commentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                )
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct DiaryCreateView: View {
    let onCreated: () -> Void

    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var content = ""
    @State private var date = Date.now
    @State private var mood = ""
    @State private var tags = ""
    @State private var author = "L"
    @State private var isSaving = false
    @State private var errorMessage: String?
    @FocusState private var focusedField: DiaryCreateField?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                DatePicker(
                    "",
                    selection: $date,
                    displayedComponents: .date
                )
                .labelsHidden()
                .datePickerStyle(.compact)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.bottom, 18)

                TextField("Title", text: $title, axis: .vertical)
                    .font(.title2.weight(.semibold))
                    .focused($focusedField, equals: .title)
                    .submitLabel(.next)
                    .onSubmit {
                        focusedField = .content
                    }

                ZStack(alignment: .topLeading) {
                    if content.isEmpty {
                        Text("Write something...")
                            .font(.body)
                            .foregroundStyle(.tertiary)
                            .padding(.top, 8)
                            .allowsHitTesting(false)
                    }

                    TextEditor(text: $content)
                        .font(.body)
                        .focused($focusedField, equals: .content)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 280)
                        .padding(.horizontal, -5)
                }
                .padding(.top, 4)

                Divider()
                    .padding(.vertical, 14)

                HStack(spacing: 10) {
                    TextField("Mood", text: $mood)
                        .font(.subheadline)
                        .textFieldStyle(.plain)

                    Text("·")
                        .foregroundStyle(.tertiary)

                    TextField("Tags", text: $tags)
                        .font(.subheadline)
                        .textFieldStyle(.plain)

                    Spacer(minLength: 8)

                    Menu(author) {
                        ForEach(["L", "G", "C"], id: \.self) { value in
                            Button(value) {
                                author = value
                            }
                        }
                    }
                    .font(.subheadline)
                }
                .foregroundStyle(.secondary)

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 12)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 14)
            .padding(.bottom, 32)
        }
        .background(Color(.systemBackground))
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") {
                    dismiss()
                }
            }

            ToolbarItem(placement: .confirmationAction) {
                Button(isSaving ? "Saving..." : "Done") {
                    Task {
                        await save()
                    }
                }
                .disabled(!canSave || isSaving)
            }
        }
        .task {
            focusedField = .title
        }
    }

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    @MainActor
    private func save() async {
        guard canSave, !isSaving else { return }

        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        do {
            let payload = DiaryCreateRequest(
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                content: content.trimmingCharacters(in: .whitespacesAndNewlines),
                date: DiaryDate.apiDate(date),
                tags: DiaryCreateRequest.parseTags(tags),
                mood: DiaryCreateRequest.normalizedOptional(mood),
                author: author
            )
            let body = try JSONEncoder().encode(payload)
            let _: DiaryEntryEnvelope = try await appModel.api.request(
                path: "/api/v1/diary",
                method: "POST",
                body: body
            )
            onCreated()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private enum DiaryCreateField {
    case title
    case content
}

private struct DiaryCreateRequest: Encodable {
    let title: String
    let content: String
    let date: String
    let tags: [String]
    let mood: String?
    let author: String

    static func parseTags(_ value: String) -> [String] {
        value
            .split(whereSeparator: { $0 == "," || $0 == "，" })
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    static func normalizedOptional(_ value: String) -> String? {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? nil : normalized
    }
}

private struct DiaryCommentCreateRequest: Encodable {
    let author: String
    let content: String
    let idempotencyKey: String

    enum CodingKeys: String, CodingKey {
        case author
        case content
        case idempotencyKey = "idempotency_key"
    }
}

private struct DiaryCommentCreateEnvelope: Decodable {
    let success: Bool
    let data: DiaryCommentCreateData
}

private struct DiaryCommentCreateData: Decodable {
    let comment: DiaryComment
}

private enum DiaryDetailLoadState {
    case loading
    case unavailable(String)
    case loaded(DiaryEntry)
}

private enum DiaryCommentDate {
    static func format(_ value: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: value) else {
            return value
        }

        return date.formatted(
            .dateTime
                .month(.abbreviated)
                .day()
                .hour()
                .minute()
        )
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

private struct DiaryEntryEnvelope: Decodable {
    let success: Bool
    let data: DiaryEntry
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
    let content: String?
    let date: String
    let tags: [String]
    let mood: String?
    let createdAt: String
    let updatedAt: String
    let author: String?
    var comments: [DiaryComment]?
    var commentsMetadata: DiaryCommentsMetadata?

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case content
        case date
        case tags
        case mood
        case author
        case comments
        case commentsMetadata = "comments_metadata"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

private struct DiaryComment: Decodable, Identifiable {
    let id: String
    let diaryID: String
    let author: String
    let content: String
    let revision: Int
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case author
        case content
        case revision
        case diaryID = "diary_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

private struct DiaryCommentsMetadata: Decodable {
    let count: Int
    let returned: Int
    let truncated: Bool
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
