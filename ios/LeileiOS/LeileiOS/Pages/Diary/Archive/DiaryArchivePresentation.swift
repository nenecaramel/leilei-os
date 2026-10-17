import SwiftUI
import UIKit

struct DiaryArchiveView: View {
    let onActiveDiaryChanged: () -> Void

    @EnvironmentObject private var appModel: AppModel
    @State private var state: DiaryArchiveLoadState = .loading
    @State private var diaryCount: Int?
    @State private var completeArchive: [DiaryEntry]?
    @State private var isLoadingMoreArchive = false
    @State private var listScrollPosition: String?

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
                        scrollPosition: $listScrollPosition,
                        hasMore:
                            diaries.count < (diaryCount ?? diaries.count),
                        isLoadingMore: isLoadingMoreArchive,
                        onLoadMore: {
                            Task {
                                await loadMoreArchive()
                            }
                        }
                    ) { id in
                        removeArchivedEntry(id)
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
            // A popped detail must not reset pagination or the list anchor.
            if case .loaded = state { return }
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

    // Only an actual restore/delete removes the single affected row. Keep
    // previously appended archive batches and their scroll coordinates.
    @MainActor
    private func removeArchivedEntry(_ id: String) {
        guard case .loaded(let diaries) = state else { return }
        let remaining = diaries.filter { $0.id != id }
        guard remaining.count != diaries.count else { return }
        completeArchive?.removeAll { $0.id == id }
        diaryCount = diaryCount.map { max(0, $0 - 1) }
        state = .loaded(remaining)
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
                let data = try await appModel.api.exportData()
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
    @Binding var scrollPosition: String?
    let hasMore: Bool
    let isLoadingMore: Bool
    let onLoadMore: () -> Void
    let onRemoved: (String) -> Void

    var body: some View {
        List {
            ForEach(DiaryMonthGroup.make(from: diaries)) { group in
                Section(group.title) {
                    ForEach(Array(group.diaries.enumerated()), id: \.element.id) { index, diary in
                        NavigationLink {
                            DiaryArchivedDetailView(
                                diaryID: diary.id,
                                onChanged: { onRemoved(diary.id) }
                            )
                        } label: {
                            DiaryRow(diary: diary)
                        }
                        .id(diary.id)
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
        .scrollPosition(id: $scrollPosition)
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

        DiaryCommentPaging.reconcile(
            page,
            into: &diary,
            replaceVisiblePage: replaceVisiblePage
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
