import SwiftUI
import UIKit

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

struct DiaryReadingContent: View {
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
