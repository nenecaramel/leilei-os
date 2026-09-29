import SwiftUI

struct DiaryView: View {
    @EnvironmentObject private var appModel: AppModel

    let target: DiaryNavigationTarget?
    let onTargetConsumed: () -> Void

    @State private var query = ""
    @State private var navigationTarget: DiaryNavigationTarget?
    @State private var timeFilter: DiaryTimeFilter = .anyTime
    @State private var authorFilter: DiaryAuthorFilter = .any
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
                DiaryListSkeleton()

            case .authRequired:
                AppStateSurface(
                    title: "Sign in",
                    actionTitle: "Sign In"
                ) {
                    Task {
                        await reauthorizeAndReload()
                    }
                }

            case .unavailable:
                if isSearching {
                    AppStateSurface(
                        title: "Unavailable",
                        actionTitle: "Retry"
                    ) {
                        Task {
                            await loadDiary()
                        }
                    }
                } else {
                    AppStateSurface(
                        title: "Unavailable",
                        actionTitle: "Retry"
                    ) {
                        Task {
                            await loadDiary()
                        }
                    }
                }

            case .loaded(let diaries):
                let visibleDiaries = filteredDiaries(diaries)
                if visibleDiaries.isEmpty {
                    if isSearching {
                        AppStateSurface(
                            title: "Nothing here",
                        )
                    } else if timeFilter == .anyTime {
                        AppStateSurface(
                            title: "Nothing here",
                        )
                    } else {
                        AppStateSurface(
                            title: "Nothing here",
                        )
                    }
                } else {
                    DiaryList(diaries: visibleDiaries) {
                        Task {
                            await loadDiary()
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .searchable(text: $query, prompt: "Search")
        .navigationDestination(isPresented: $archivePresented) {
            DiaryArchiveView {
                Task {
                    await loadDiary()
                }
            }
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

                    Picker("Author", selection: $authorFilter) {
                        Text("Any Author")
                            .tag(DiaryAuthorFilter.any)

                        Text("L")
                            .tag(DiaryAuthorFilter.l)

                        Text("G")
                            .tag(DiaryAuthorFilter.g)

                        Text("C")
                            .tag(DiaryAuthorFilter.c)
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
        .navigationDestination(
            item: $navigationTarget
        ) { target in
            if target.scope == "archived" {
                DiaryArchivedDetailView(
                    diaryID: target.diaryID,
                    onChanged: {
                        Task {
                            await loadDiary()
                        }
                    }
                )
            } else {
                DiaryDetailView(
                    diaryID: target.diaryID,
                    onChanged: {
                        Task {
                            await loadDiary()
                        }
                    }
                )
            }
        }
        .task {
            await loadDiary()
        }
        .task(id: target) {
            guard let target else {
                return
            }

            navigationTarget = target
            onTargetConsumed()
        }
        .refreshable {
            await loadDiary()
        }
    }

    @MainActor
    private func loadDiary() async {
        state = .loading

        do {
            let result = try await loadAllDiaryPages()
            diaryCount = result.count
            state = .loaded(result.diaries)
        } catch LeileiAPIError.missingAccessToken {
            state = .authRequired("Sign in")
        } catch LeileiAPIError.unauthorized {
            await appModel.refreshConnectivity()
            state = .authRequired("Sign in")
        } catch {
            state = .unavailable("Unavailable")
        }
    }

    @MainActor
    private func reauthorizeAndReload() async {
        state = .loading

        do {
            try await appModel.reauthorize()
            await loadDiary()
        } catch {
            state = .unavailable("Unavailable")
        }
    }

    private var isSearching: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func loadAllDiaryPages() async throws -> (diaries: [DiaryEntry], count: Int) {
        let pageSize = 100
        var offset = 0
        var totalCount = 0
        var diaries: [DiaryEntry] = []
        var seenIDs = Set<String>()

        while true {
            try Task.checkCancellation()

            let response: DiaryListEnvelope = try await appModel.api.request(
                path: diaryPath(
                    limit: pageSize,
                    offset: offset
                )
            )
            totalCount = response.data.metadata.count

            let newDiaries = response.data.diaries.filter {
                seenIDs.insert($0.id).inserted
            }
            diaries.append(contentsOf: newDiaries)

            if diaries.count >= totalCount
                || response.data.diaries.isEmpty
                || newDiaries.isEmpty {
                break
            }

            offset += response.data.diaries.count
        }

        return (diaries, totalCount)
    }

    private func diaryPath(
        limit: Int,
        offset: Int
    ) -> String {
        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset)),
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
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let dateFrom = DiaryDate.apiDate(customStartDate)
        let dateTo = DiaryDate.apiDate(customEndDate)

        return diaries.filter { diary in
            if timeFilter == .custom
                && (diary.date < dateFrom || diary.date > dateTo) {
                return false
            }

            if let author = authorFilter.author,
               diary.author != author {
                return false
            }

            guard !normalizedQuery.isEmpty else {
                return true
            }

            return diary.title.localizedCaseInsensitiveContains(normalizedQuery)
                || (diary.content?.localizedCaseInsensitiveContains(normalizedQuery) ?? false)
                || (diary.mood?.localizedCaseInsensitiveContains(normalizedQuery) ?? false)
                || diary.tags.contains {
                    $0.localizedCaseInsensitiveContains(normalizedQuery)
                }
        }
    }
}

private enum DiaryAuthorFilter: String, CaseIterable {
    case any
    case l = "L"
    case g = "G"
    case c = "C"

    var author: String? {
        self == .any ? nil : rawValue
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

private struct DiaryArchiveView: View {
    let onActiveDiaryChanged: () -> Void

    @EnvironmentObject private var appModel: AppModel
    @State private var state: DiaryArchiveLoadState = .loading
    @State private var diaryCount: Int?
    @State private var completeArchive: [DiaryEntry]?
    @State private var isLoadingMoreArchive = false

    var body: some View {
        Group {
            switch state {
            case .loading:
                DiaryListSkeleton()

            case .unavailable:
                AppStateSurface(
                    title: "Unavailable",
                    actionTitle: "Retry"
                ) {
                    Task {
                        await loadArchive()
                    }
                }

            case .loaded(let diaries):
                if diaries.isEmpty {
                    AppStateSurface(
                        title: "Nothing here",
                    )
                } else {
                    DiaryArchiveList(
                        diaries: diaries,
                        hasMore:
                            diaries.count < (diaryCount ?? diaries.count),
                        isLoadingMore: isLoadingMoreArchive,
                        onLoadMore: {
                            Task {
                                await loadMoreArchive()
                            }
                        }
                    ) {
                        Task {
                            await loadArchive()
                        }
                        onActiveDiaryChanged()
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
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
            await loadArchive()
        }
        .refreshable {
            await loadArchive()
        }
    }

    @MainActor
    private func loadArchive() async {
        state = .loading
        completeArchive = nil
        isLoadingMoreArchive = false

        do {
            let response: DiaryListEnvelope = try await appModel.api.request(
                path: "/api/v1/diary/archived"
            )
            diaryCount = response.data.metadata.count
            state = .loaded(response.data.diaries)
        } catch {
            state = .unavailable("Unavailable")
        }
    }

    @MainActor
    private func loadMoreArchive() async {
        guard !isLoadingMoreArchive,
              case .loaded(let visible) = state,
              visible.count < (diaryCount ?? visible.count) else {
            return
        }

        isLoadingMoreArchive = true
        defer { isLoadingMoreArchive = false }

        do {
            let all: [DiaryEntry]
            if let completeArchive {
                all = completeArchive
            } else {
                let data = try await appModel.api.exportData(
                    includeAudit: false
                )
                let snapshot = try JSONDecoder().decode(
                    LeileiExportSnapshot.self,
                    from: data
                )

                all = (snapshot.data.diary ?? [])
                    .filter { $0.status == "archived" }
                    .sorted {
                        if $0.date != $1.date {
                            return $0.date > $1.date
                        }
                        if $0.createdAt != $1.createdAt {
                            return $0.createdAt > $1.createdAt
                        }
                        return $0.id > $1.id
                    }
                    .map {
                        DiaryEntry(
                            id: $0.id,
                            title: $0.title,
                            content: $0.content,
                            date: $0.date,
                            tags: $0.tags,
                            mood: $0.mood,
                            createdAt: $0.createdAt,
                            updatedAt: $0.updatedAt,
                            author: $0.author,
                            comments: nil,
                            commentsMetadata: nil
                        )
                    }
                completeArchive = all
                diaryCount = all.count
            }

            state = .loaded(
                Array(
                    all.prefix(
                        min(
                            visible.count + 50,
                            all.count
                        )
                    )
                )
            )
        } catch {
            // Keep the already loaded archive visible.
        }
    }
}

private struct DiaryArchiveList: View {
    let diaries: [DiaryEntry]
    let hasMore: Bool
    let isLoadingMore: Bool
    let onLoadMore: () -> Void
    let onChanged: () -> Void

    var body: some View {
        List {
            ForEach(DiaryMonthGroup.make(from: diaries)) { group in
                Section(group.title) {
                    ForEach(Array(group.diaries.enumerated()), id: \.element.id) { index, diary in
                        NavigationLink {
                            DiaryArchivedDetailView(
                                diaryID: diary.id,
                                onChanged: onChanged
                            )
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

            if hasMore {
                Section {
                    Button(action: onLoadMore) {
                        HStack(spacing: 8) {
                            if isLoadingMore {
                                ProgressView()
                                    .controlSize(.small)
                            }

                            Text("More")
                        }
                        .frame(
                            maxWidth: .infinity,
                            alignment: .center
                        )
                    }
                    .disabled(isLoadingMore)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color(.systemBackground))
    }
}

struct DiaryArchivedDetailView: View {
    let diaryID: String
    let onChanged: () -> Void

    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var state: DiaryDetailLoadState = .loading
    @State private var isRestoring = false
    @State private var isDeleting = false
    @State private var showingRestoreConfirmation = false
    @State private var showingDeleteConfirmation = false
    @State private var actionError: String?
    @State private var commentError: String?
    @State private var commentNextBefore: String?
    @State private var commentsHaveMore = false
    @State private var isLoadingOlderComments = false

    var body: some View {
        Group {
            switch state {
            case .loading:
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

            case .unavailable:
                AppStateSurface(
                    title: "Unavailable",
                )

            case .loaded(let diary):
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        DiaryReadingContent(diary: diary)

                        DiaryArchivedCommentsSection(
                            comments: diary.comments ?? [],
                            count: diary.commentsMetadata?.count
                                ?? diary.comments?.count
                                ?? 0,
                            errorMessage: commentError,
                            hasMore: commentsHaveMore,
                            isLoadingMore: isLoadingOlderComments,
                            onLoadMore: {
                                Task {
                                    await loadOlderComments()
                                }
                            }
                        )
                        .padding(.top, 24)

                        if let actionError {
                            Text(actionError)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .padding(.top, 12)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 12)
                    .padding(.bottom, 32)
                }
                .background(Color(.systemBackground))
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                if case .loaded(let diary) = state {
                    Text(DiaryDate.formatDetail(diary.date))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Restore") {
                        showingRestoreConfirmation = true
                    }

                    Button("Delete", role: .destructive) {
                        showingDeleteConfirmation = true
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 18, weight: .medium))
                }
                .accessibilityLabel("Archived diary actions")
                .disabled(isRestoring || isDeleting)
            }
        }
        .appConfirmationAlert(
            title: "Restore diary?",
            message: "This diary will be returned to your active diary.",
            actionTitle: "Restore",
            isPresented: $showingRestoreConfirmation
        ) {
            Task {
                await restoreDiary()
            }
        }
        .appConfirmationAlert(
            title: "Delete diary?",
            message: "This diary will be permanently deleted. This cannot be undone.",
            actionTitle: "Delete",
            actionRole: .destructive,
            isPresented: $showingDeleteConfirmation
        ) {
            Task {
                await deleteDiary()
            }
        }
        .task(id: diaryID) {
            await loadDetail()
        }
    }

    @MainActor
    private func loadDetail() async {
        state = .loading

        do {
            let response: DiaryEntryEnvelope = try await appModel.api.request(
                path: "/api/v1/diary/archived/\(diaryID)"
            )
            state = .loaded(response.data)
            commentError = nil
            commentNextBefore = nil
            commentsHaveMore =
                response.data.commentsMetadata?.truncated == true

            if commentsHaveMore {
                await primeCommentPagination()
            }
        } catch {
            state = .unavailable("Unavailable")
        }
    }

    @MainActor
    private func primeCommentPagination() async {
        guard commentsHaveMore,
              commentNextBefore == nil,
              !isLoadingOlderComments else {
            return
        }

        isLoadingOlderComments = true
        defer { isLoadingOlderComments = false }

        do {
            let page = try await readCommentPage(
                before: nil
            )
            reconcileCommentPage(
                page,
                replaceVisiblePage: true
            )
            commentError = nil
        } catch {
            commentError = "Failed"
        }
    }

    @MainActor
    private func loadOlderComments() async {
        guard commentsHaveMore,
              !isLoadingOlderComments else {
            return
        }

        if commentNextBefore == nil {
            await primeCommentPagination()
        }

        guard let before = commentNextBefore,
              commentsHaveMore,
              !isLoadingOlderComments else {
            return
        }

        isLoadingOlderComments = true
        defer { isLoadingOlderComments = false }

        do {
            let page = try await readCommentPage(
                before: before
            )
            reconcileCommentPage(
                page,
                replaceVisiblePage: false
            )
            commentError = nil
        } catch {
            commentError = "Failed"
        }
    }

    @MainActor
    private func readCommentPage(
        before: String?
    ) async throws -> DiaryCommentListData {
        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "limit", value: "50"),
        ]
        if let before {
            components.queryItems?.append(
                URLQueryItem(
                    name: "before",
                    value: before
                )
            )
        }

        let response: DiaryCommentListEnvelope =
            try await appModel.api.request(
                path:
                    "/api/v1/diary/archived/\(diaryID)/comments"
                    + "?\(components.percentEncodedQuery ?? "")"
            )
        return response.data
    }

    private func reconcileCommentPage(
        _ page: DiaryCommentListData,
        replaceVisiblePage: Bool
    ) {
        guard case .loaded(var diary) = state else {
            return
        }

        let existing =
            replaceVisiblePage
                ? []
                : (diary.comments ?? [])
        let existingIDs = Set(existing.map(\.id))
        let incoming = page.comments.filter {
            !existingIDs.contains($0.id)
        }

        var combined =
            replaceVisiblePage
                ? page.comments
                : incoming + existing
        combined.sort {
            if $0.createdAt == $1.createdAt {
                return $0.id < $1.id
            }
            return $0.createdAt < $1.createdAt
        }

        diary.comments = combined
        diary.commentsMetadata = DiaryCommentsMetadata(
            count: page.metadata.count,
            returned: combined.count,
            truncated: page.metadata.hasMore
        )
        state = .loaded(diary)
        commentsHaveMore = page.metadata.hasMore
        commentNextBefore = page.metadata.nextBefore
    }

    @MainActor
    private func restoreDiary() async {
        guard !isRestoring else { return }

        isRestoring = true
        actionError = nil
        defer { isRestoring = false }

        do {
            let _: DiarySuccessEnvelope = try await appModel.api.request(
                path: "/api/v1/diary/archived/\(diaryID)/restore",
                method: "POST"
            )
            onChanged()
            dismiss()
        } catch {
            actionError = "Failed"
        }
    }

    @MainActor
    private func deleteDiary() async {
        guard !isDeleting else { return }

        isDeleting = true
        actionError = nil
        defer { isDeleting = false }

        do {
            let _: NoContentResponse = try await appModel.api.request(
                path: "/api/v1/diary/archived/\(diaryID)/permanent",
                method: "DELETE"
            )
            onChanged()
            dismiss()
        } catch {
            actionError = "Failed"
        }
    }
}

private struct DiaryArchivedCommentsSection: View {
    let comments: [DiaryComment]
    let count: Int
    let errorMessage: String?
    let hasMore: Bool
    let isLoadingMore: Bool
    let onLoadMore: () -> Void

    var body: some View {
        if count > 0 {
            VStack(alignment: .leading, spacing: 16) {
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
                }

                if hasMore {
                    Button(action: onLoadMore) {
                        HStack(spacing: 8) {
                            if isLoadingMore {
                                ProgressView()
                                    .controlSize(.small)
                            }

                            Text(
                                isLoadingMore
                                    ? "Loading…"
                                    : "More"
                            )
                        }
                        .frame(
                            maxWidth: .infinity,
                            alignment: .center
                        )
                    }
                    .buttonStyle(.borderless)
                    .disabled(isLoadingMore)
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

private enum DiaryArchiveLoadState {
    case loading
    case unavailable(String)
    case loaded([DiaryEntry])
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

private struct DiaryListSkeleton: View {
    var body: some View {
        List {
            ForEach(0..<5, id: \.self) { index in
                VStack(alignment: .leading, spacing: 5) {
                    Text(index.isMultiple(of: 2) ? "Diary entry title" : "Another diary title")
                        .font(.body.weight(.semibold))

                    Text(index.isMultiple(of: 2) ? "Entry metadata" : "Diary metadata")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .redacted(reason: .placeholder)
                .listRowBackground(Color(.systemBackground))
                .padding(.vertical, 2)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color(.systemBackground))
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct DiaryList: View {
    let diaries: [DiaryEntry]
    let onChanged: () -> Void

    var body: some View {
        List {
            ForEach(DiaryMonthGroup.make(from: diaries)) { group in
                Section(group.title) {
                    ForEach(Array(group.diaries.enumerated()), id: \.element.id) { index, diary in
                        NavigationLink {
                            DiaryDetailView(
                                diaryID: diary.id,
                                onChanged: onChanged
                            )
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

struct DiaryDetailView: View {
    let diaryID: String
    let onChanged: () -> Void

    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var state: DiaryDetailLoadState = .loading
    @State private var isEditing = false
    @State private var draftTitle = ""
    @State private var draftContent = ""
    @State private var draftDate = Date.now
    @State private var draftMood = ""
    @State private var draftTags = ""
    @State private var draftAuthor = "L"
    @State private var isSavingDiary = false
    @State private var editError: String?

    @State private var commentEditorMode: DiaryCommentEditorMode?
    @State private var commentError: String?
    @State private var commentNextBefore: String?
    @State private var commentsHaveMore = false
    @State private var isLoadingOlderComments = false
    @State private var isArchiving = false
    @State private var showingArchiveConfirmation = false

    var body: some View {
        Group {
            switch state {
            case .loading:
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

            case .unavailable:
                AppStateSurface(
                    title: "Unavailable",
                )

            case .loaded(let diary):
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        if isEditing {
                            DiaryEditorFields(
                                title: $draftTitle,
                                content: $draftContent,
                                mood: $draftMood,
                                tags: $draftTags,
                                author: $draftAuthor,
                                autoFocusTitle: false
                            )

                            if let editError {
                                Text(editError)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .padding(.top, 12)
                            }
                        } else {
                            DiaryReadingContent(diary: diary)

                            DiaryCommentsSection(
                                comments: diary.comments ?? [],
                                count: diary.commentsMetadata?.count
                                    ?? diary.comments?.count
                                    ?? 0,
                                errorMessage: commentError,
                                hasMore: commentsHaveMore,
                                isLoadingMore: isLoadingOlderComments,
                                onLoadMore: {
                                    Task {
                                        await loadOlderComments()
                                    }
                                },
                                onEdit: { comment in
                                    commentEditorMode = .edit(comment)
                                },
                                onDelete: { comment in
                                    Task {
                                        await deleteComment(comment)
                                    }
                                }
                            )
                            .padding(.top, 24)

                            if let editError {
                                Text(editError)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .padding(.top, 12)
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 12)
                    .padding(.bottom, 32)
                }
                .background(Color(.systemBackground))
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(isEditing)
        .toolbar {
            if isEditing {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        isEditing = false
                        editError = nil
                    }
                    .disabled(isSavingDiary)
                }

                ToolbarItem(placement: .principal) {
                    DatePicker(
                        "",
                        selection: $draftDate,
                        displayedComponents: .date
                    )
                    .labelsHidden()
                    .datePickerStyle(.compact)
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button(isSavingDiary ? "Saving…" : "Done") {
                        Task {
                            await saveDiaryEdit()
                        }
                    }
                    .disabled(!canSaveEdit || isSavingDiary)
                }
            } else {
                ToolbarItem(placement: .principal) {
                    if case .loaded(let diary) = state {
                        Text(DiaryDate.formatDetail(diary.date))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Edit") {
                            beginEditing()
                        }

                        Button("Comment") {
                            commentEditorMode = .create
                        }

                        Button("Archive") {
                            showingArchiveConfirmation = true
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 18, weight: .medium))
                    }
                    .accessibilityLabel("Diary actions")
                    .disabled(isArchiving)
                }
            }
        }
        .appConfirmationAlert(
            title: "Archive diary?",
            message: "You can restore it later from Archive.",
            actionTitle: "Archive",
            isPresented: $showingArchiveConfirmation
        ) {
            Task {
                await archiveDiary()
            }
        }
        .sheet(item: $commentEditorMode) { mode in
            DiaryCommentEditorSheet(
                diaryID: diaryID,
                mode: mode
            ) { comment, isNew in
                applySavedComment(comment, isNew: isNew)
            }
        }
        .task(id: diaryID) {
            await loadDetail()
        }
    }

    private var canSaveEdit: Bool {
        !draftTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !draftContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func beginEditing() {
        guard case .loaded(let diary) = state else { return }

        draftTitle = diary.title
        draftContent = diary.content ?? ""
        draftDate = DiaryDate.parse(diary.date) ?? .now
        draftMood = diary.mood ?? ""
        draftTags = diary.tags.joined(separator: ", ")
        draftAuthor = diary.author ?? "L"
        editError = nil
        isEditing = true
    }

    @MainActor
    private func loadDetail() async {
        state = .loading

        do {
            let response: DiaryEntryEnvelope = try await appModel.api.request(
                path: "/api/v1/diary/\(diaryID)"
            )
            state = .loaded(response.data)
            commentError = nil
            commentNextBefore = nil
            commentsHaveMore =
                response.data.commentsMetadata?.truncated == true

            if commentsHaveMore {
                await primeCommentPagination()
            }
        } catch {
            state = .unavailable("Unavailable")
        }
    }

    @MainActor
    private func primeCommentPagination() async {
        guard commentsHaveMore,
              commentNextBefore == nil,
              !isLoadingOlderComments else {
            return
        }

        isLoadingOlderComments = true
        defer { isLoadingOlderComments = false }

        do {
            let page = try await readCommentPage(
                scope: .active,
                before: nil
            )
            reconcileCommentPage(
                page,
                replaceVisiblePage: true
            )
            commentError = nil
        } catch {
            commentError = "Failed"
        }
    }

    @MainActor
    private func loadOlderComments() async {
        guard commentsHaveMore,
              !isLoadingOlderComments else {
            return
        }

        if commentNextBefore == nil {
            await primeCommentPagination()
        }

        guard let before = commentNextBefore,
              commentsHaveMore,
              !isLoadingOlderComments else {
            return
        }

        isLoadingOlderComments = true
        defer { isLoadingOlderComments = false }

        do {
            let page = try await readCommentPage(
                scope: .active,
                before: before
            )
            reconcileCommentPage(
                page,
                replaceVisiblePage: false
            )
            commentError = nil
        } catch {
            commentError = "Failed"
        }
    }

    @MainActor
    private func readCommentPage(
        scope: DiaryCommentScope,
        before: String?
    ) async throws -> DiaryCommentListData {
        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "limit", value: "50"),
        ]
        if let before {
            components.queryItems?.append(
                URLQueryItem(
                    name: "before",
                    value: before
                )
            )
        }

        let basePath =
            scope == .active
                ? "/api/v1/diary/\(diaryID)/comments"
                : "/api/v1/diary/archived/\(diaryID)/comments"
        let response: DiaryCommentListEnvelope =
            try await appModel.api.request(
                path:
                    basePath
                    + "?\(components.percentEncodedQuery ?? "")"
            )
        return response.data
    }

    private func reconcileCommentPage(
        _ page: DiaryCommentListData,
        replaceVisiblePage: Bool
    ) {
        guard case .loaded(var diary) = state else {
            return
        }

        let existing =
            replaceVisiblePage
                ? []
                : (diary.comments ?? [])
        let existingIDs = Set(existing.map(\.id))
        let incoming = page.comments.filter {
            !existingIDs.contains($0.id)
        }

        var combined =
            replaceVisiblePage
                ? page.comments
                : incoming + existing
        combined.sort {
            if $0.createdAt == $1.createdAt {
                return $0.id < $1.id
            }
            return $0.createdAt < $1.createdAt
        }

        diary.comments = combined
        diary.commentsMetadata = DiaryCommentsMetadata(
            count: page.metadata.count,
            returned: combined.count,
            truncated: page.metadata.hasMore
        )
        state = .loaded(diary)
        commentsHaveMore = page.metadata.hasMore
        commentNextBefore = page.metadata.nextBefore
    }

    @MainActor
    private func saveDiaryEdit() async {
        guard canSaveEdit, !isSavingDiary else { return }
        guard case .loaded(let current) = state else { return }

        isSavingDiary = true
        editError = nil
        defer { isSavingDiary = false }

        do {
            let payload = DiaryCreateRequest(
                title: draftTitle.trimmingCharacters(in: .whitespacesAndNewlines),
                content: draftContent.trimmingCharacters(in: .whitespacesAndNewlines),
                date: DiaryDate.apiDate(draftDate),
                tags: DiaryCreateRequest.parseTags(draftTags),
                mood: DiaryCreateRequest.normalizedOptional(draftMood),
                author: draftAuthor
            )
            let body = try JSONEncoder().encode(payload)
            let response: DiaryEntryEnvelope = try await appModel.api.request(
                path: "/api/v1/diary/\(diaryID)",
                method: "PATCH",
                body: body
            )

            var updated = response.data
            updated.comments = current.comments
            updated.commentsMetadata = current.commentsMetadata
            state = .loaded(updated)
            isEditing = false
            onChanged()
        } catch {
            editError = "Failed"
        }
    }

    @MainActor
    private func archiveDiary() async {
        guard !isArchiving else { return }

        editError = nil
        isArchiving = true
        defer { isArchiving = false }

        do {
            let _: DiarySuccessEnvelope = try await appModel.api.request(
                path: "/api/v1/diary/\(diaryID)",
                method: "DELETE"
            )
            onChanged()
            dismiss()
        } catch {
            editError = "Failed"
        }
    }

    private func applySavedComment(
        _ comment: DiaryComment,
        isNew: Bool
    ) {
        guard case .loaded(var diary) = state else { return }

        var comments = diary.comments ?? []
        if let index = comments.firstIndex(where: { $0.id == comment.id }) {
            comments[index] = comment
        } else {
            comments.append(comment)
        }
        comments.sort {
            if $0.createdAt == $1.createdAt {
                return $0.id < $1.id
            }
            return $0.createdAt < $1.createdAt
        }

        let oldCount = diary.commentsMetadata?.count
            ?? max(0, comments.count - (isNew ? 1 : 0))
        diary.comments = comments
        diary.commentsMetadata = DiaryCommentsMetadata(
            count: oldCount + (isNew ? 1 : 0),
            returned: comments.count,
            truncated: diary.commentsMetadata?.truncated ?? false
        )
        commentError = nil
        state = .loaded(diary)
    }

    @MainActor
    private func deleteComment(_ comment: DiaryComment) async {
        commentError = nil

        do {
            let payload = DiaryCommentDeleteRequest(
                expectedRevision: comment.revision
            )
            let body = try JSONEncoder().encode(payload)
            let _: DiaryCommentDeleteEnvelope = try await appModel.api.request(
                path: "/api/v1/diary/\(diaryID)/comments/\(comment.id)",
                method: "DELETE",
                body: body
            )

            guard case .loaded(var diary) = state else { return }
            let comments = (diary.comments ?? []).filter {
                $0.id != comment.id
            }
            let oldCount = diary.commentsMetadata?.count
                ?? (comments.count + 1)
            diary.comments = comments
            diary.commentsMetadata = DiaryCommentsMetadata(
                count: max(0, oldCount - 1),
                returned: comments.count,
                truncated: diary.commentsMetadata?.truncated ?? false
            )
            state = .loaded(diary)
        } catch {
            commentError = "Failed"
        }
    }
}

private struct DiaryReadingContent: View {
    let diary: DiaryEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(diary.title)
                .font(.title2.weight(.semibold))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)

            DiaryMetadataLine(diary: diary)
                .padding(.top, 8)

            if let content = diary.content, !content.isEmpty {
                Text(content)
                    .font(.body)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 12)
            }
        }
    }
}

private struct DiaryMetadataLine: View {
    let diary: DiaryEntry

    private var parts: [String] {
        var result: [String] = []

        if let author = diary.author,
           !author.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            result.append(author)
        }

        if let mood = diary.mood?.trimmingCharacters(in: .whitespacesAndNewlines),
           !mood.isEmpty {
            result.append(mood)
        }

        if !diary.tags.isEmpty {
            result.append(
                diary.tags.map { "#\($0)" }.joined(separator: " ")
            )
        }

        return result
    }

    var body: some View {
        if !parts.isEmpty {
            Text(parts.joined(separator: " · "))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct DiaryCommentsSection: View {
    let comments: [DiaryComment]
    let count: Int
    let errorMessage: String?
    let hasMore: Bool
    let isLoadingMore: Bool
    let onLoadMore: () -> Void
    let onEdit: (DiaryComment) -> Void
    let onDelete: (DiaryComment) -> Void

    @State private var pendingDelete: DiaryComment?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
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

                        Spacer(minLength: 8)

                        Menu {
                            Button("Edit") {
                                onEdit(comment)
                            }

                            Button("Delete", role: .destructive) {
                                pendingDelete = comment
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .frame(width: 24, height: 24)
                        }
                        .accessibilityLabel("Comment actions")
                    }

                    Text(comment.content)
                        .font(.body)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
            }

            if hasMore {
                Button(action: onLoadMore) {
                    HStack(spacing: 8) {
                        if isLoadingMore {
                            ProgressView()
                                .controlSize(.small)
                        }

                        Text(
                            isLoadingMore
                                ? "Loading…"
                                : "More"
                        )
                    }
                    .frame(
                        maxWidth: .infinity,
                        alignment: .center
                    )
                }
                .buttonStyle(.borderless)
                .disabled(isLoadingMore)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .appConfirmationAlert(
            title: "Delete comment?",
            message: "This comment will be permanently deleted. This cannot be undone.",
            actionTitle: "Delete",
            actionRole: .destructive,
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            )
        ) {
            if let pendingDelete {
                onDelete(pendingDelete)
            }
            pendingDelete = nil
        }
    }
}

private enum DiaryCommentEditorMode: Identifiable {
    case create
    case edit(DiaryComment)

    var id: String {
        switch self {
        case .create:
            return "create"
        case .edit(let comment):
            return "edit:\(comment.id)"
        }
    }

    var comment: DiaryComment? {
        switch self {
        case .create:
            return nil
        case .edit(let comment):
            return comment
        }
    }
}

private struct DiaryCommentEditorSheet: View {
    let diaryID: String
    let mode: DiaryCommentEditorMode
    let onSaved: (DiaryComment, Bool) -> Void

    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var content: String
    @State private var author: String
    @State private var isSaving = false
    @State private var errorMessage: String?
    @FocusState private var isFocused: Bool

    init(
        diaryID: String,
        mode: DiaryCommentEditorMode,
        onSaved: @escaping (DiaryComment, Bool) -> Void
    ) {
        self.diaryID = diaryID
        self.mode = mode
        self.onSaved = onSaved
        _content = State(initialValue: mode.comment?.content ?? "")
        _author = State(initialValue: mode.comment?.author ?? "L")
    }

    var body: some View {
        NavigationStack {
            TextEditor(text: $content)
                .font(.body)
                .scrollContentBackground(.hidden)
                .focused($isFocused)
                .padding(.horizontal, 14)
                .padding(.top, 8)
                .background(Color(.systemBackground))
                .navigationTitle(mode.comment == nil ? "Add Comment" : "Edit Comment")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") {
                            dismiss()
                        }
                        .disabled(isSaving)
                    }

                    ToolbarItem(placement: .confirmationAction) {
                        Button(
                            isSaving
                                ? "Saving…"
                                : (mode.comment == nil ? "Add" : "Done")
                        ) {
                            Task {
                                await save()
                            }
                        }
                        .disabled(
                            isSaving ||
                            content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        )
                    }

                    if mode.comment == nil {
                        ToolbarItem(placement: .bottomBar) {
                            Menu {
                                ForEach(["L", "G", "C"], id: \.self) { value in
                                    Button(value) {
                                        author = value
                                    }
                                }
                            } label: {
                                Text("Author \(author)")
                            }
                        }
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(.systemBackground))
                    }
                }
        }
        .task {
            isFocused = true
        }
    }

    @MainActor
    private func save() async {
        let normalized = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty, !isSaving else { return }

        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        do {
            if let comment = mode.comment {
                let payload = DiaryCommentUpdateRequest(
                    expectedRevision: comment.revision,
                    content: normalized
                )
                let body = try JSONEncoder().encode(payload)
                let response: DiaryCommentEnvelope = try await appModel.api.request(
                    path: "/api/v1/diary/\(diaryID)/comments/\(comment.id)",
                    method: "PATCH",
                    body: body
                )
                onSaved(response.data, false)
            } else {
                let payload = DiaryCommentCreateRequest(
                    author: author,
                    content: normalized,
                    idempotencyKey: "ios:diary-comment:\(UUID().uuidString)"
                )
                let body = try JSONEncoder().encode(payload)
                let response: DiaryCommentCreateEnvelope = try await appModel.api.request(
                    path: "/api/v1/diary/\(diaryID)/comments",
                    method: "POST",
                    body: body
                )
                onSaved(response.data.comment, true)
            }

            dismiss()
        } catch {
            errorMessage = "Failed"
        }
    }
}

private struct DiaryEditorFields: View {
    @Binding var title: String
    @Binding var content: String
    @Binding var mood: String
    @Binding var tags: String
    @Binding var author: String

    let autoFocusTitle: Bool

    @FocusState private var focusedField: DiaryEditorField?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TextField("Title", text: $title, axis: .vertical)
                .font(.title2.weight(.semibold))
                .focused($focusedField, equals: .title)
                .submitLabel(.next)
                .onSubmit {
                    focusedField = .content
                }

            HStack(spacing: 8) {
                Menu {
                    ForEach(["L", "G", "C"], id: \.self) { value in
                        Button(value) {
                            author = value
                        }
                    }
                } label: {
                    Text(author)
                }

                Text("·")
                    .foregroundStyle(.tertiary)

                TextField("Mood", text: $mood)
                    .textFieldStyle(.plain)
                    .fixedSize(horizontal: true, vertical: false)

                Text("·")
                    .foregroundStyle(.tertiary)

                TextField("Tags", text: $tags)
                    .textFieldStyle(.plain)
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding(.top, 8)
            .padding(.bottom, 12)

            TextField(
                "Write something...",
                text: $content,
                axis: .vertical
            )
            .font(.body)
            .textFieldStyle(.plain)
            .focused($focusedField, equals: .content)
            .fixedSize(horizontal: false, vertical: true)
            .frame(
                maxWidth: .infinity,
                minHeight: 300,
                alignment: .topLeading
            )
        }
        .task {
            guard autoFocusTitle else { return }
            try? await Task.sleep(for: .milliseconds(250))
            if !Task.isCancelled {
                focusedField = .title
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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                DiaryEditorFields(
                    title: $title,
                    content: $content,
                    mood: $mood,
                    tags: $tags,
                    author: $author,
                    autoFocusTitle: true
                )

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 12)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
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

            ToolbarItem(placement: .principal) {
                DatePicker(
                    "",
                    selection: $date,
                    displayedComponents: .date
                )
                .labelsHidden()
                .datePickerStyle(.compact)
            }

            ToolbarItem(placement: .confirmationAction) {
                Button(isSaving ? "Saving…" : "Done") {
                    Task {
                        await save()
                    }
                }
                .disabled(!canSave || isSaving)
            }
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
            errorMessage = "Failed"
        }
    }
}

private enum DiaryEditorField {
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

private struct DiaryCommentEnvelope: Decodable {
    let success: Bool
    let data: DiaryComment
}

private struct DiaryCommentListEnvelope: Decodable {
    let success: Bool
    let data: DiaryCommentListData
}

private struct DiaryCommentListData: Decodable {
    let comments: [DiaryComment]
    let metadata: DiaryCommentListMetadata
}

private struct DiaryCommentListMetadata: Decodable {
    let count: Int
    let returned: Int
    let hasMore: Bool
    let nextBefore: String?

    enum CodingKeys: String, CodingKey {
        case count
        case returned
        case hasMore = "has_more"
        case nextBefore = "next_before"
    }
}

private struct DiaryCommentUpdateRequest: Encodable {
    let expectedRevision: Int
    let content: String

    enum CodingKeys: String, CodingKey {
        case content
        case expectedRevision = "expected_revision"
    }
}

private struct DiaryCommentDeleteRequest: Encodable {
    let expectedRevision: Int

    enum CodingKeys: String, CodingKey {
        case expectedRevision = "expected_revision"
    }
}

private struct DiaryCommentDeleteEnvelope: Decodable {
    let success: Bool
    let data: DiaryCommentDeleteData
}

private struct DiaryCommentDeleteData: Decodable {
    let commentID: String
    let deleted: Bool

    enum CodingKeys: String, CodingKey {
        case deleted
        case commentID = "comment_id"
    }
}

private struct DiarySuccessEnvelope: Decodable {
    let success: Bool
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

private enum DiaryCommentScope: Equatable {
    case active
    case archived
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

    static func parse(_ value: String) -> Date? {
        guard let components = components(from: value) else {
            return nil
        }
        return date(from: components)
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
