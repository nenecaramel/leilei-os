import SwiftUI
import UIKit

struct DaySpaceDiaryPaperDetail: View {
    let diary: DaySpaceDiary
    let onSaved: (DaySpaceDiary) -> Void
    let onClosed: () -> Void

    @EnvironmentObject private var appModel: AppModel

    @State private var title: String
    @State private var content: String
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var discardConfirmationPresented = false

    init(
        diary: DaySpaceDiary,
        onSaved: @escaping (DaySpaceDiary) -> Void,
        onClosed: @escaping () -> Void
    ) {
        self.diary = diary
        self.onSaved = onSaved
        self.onClosed = onClosed
        _title = State(
            initialValue: diary.title
        )
        _content = State(
            initialValue: diary.content
        )
    }

    var body: some View {
        DaySpacePaperDetailLayer(
            dateLabel: DaySpaceDate.paperLabel(
                diary.date
            ),
            errorMessage: errorMessage,
            onRequestClose: {
                requestVeilClose()
            },
            topRight: {
                HStack(spacing: 5) {
                    Button("Cancel") {
                        onClosed()
                    }
                    .disabled(isSaving)

                    Text("·")

                    Button(
                        isSaving
                            ? "Saving…"
                            : "Save"
                    ) {
                        Task {
                            await save()
                        }
                    }
                    .disabled(
                        isSaving
                            || isInvalid
                            || !isDirty
                    )
                }
                .font(
                    .system(
                        size: 13
                    )
                )
                .foregroundStyle(
                    Color(
                        white: 0.43
                    )
                )
            },
            signature: {
                Text(
                    diary.author?.rawValue
                        ?? "—"
                )
                .font(
                    .system(
                        size: 20,
                        weight: .medium,
                        design: .serif
                    )
                )
                .foregroundStyle(
                    Color(
                        white: 0.52
                    )
                )
                .frame(
                    minWidth: 32,
                    minHeight: 28
                )
            }
        ) {
            VStack(
                alignment: .leading,
                spacing: 0
            ) {
                TextField(
                    "Title",
                    text: $title
                )
                .textFieldStyle(.plain)
                .font(
                    .system(
                        size: 17,
                        weight: .medium
                    )
                )
                .foregroundStyle(
                    Color(
                        white: 0.09
                    )
                )
                .lineLimit(1)
                .frame(height: 30)
                .disabled(isSaving)
                .onChange(of: title) {
                    _,
                    _ in
                    errorMessage = nil
                }

                DaySpacePaperBodyEditor(
                    text: content,
                    disabled: isSaving
                ) { value in
                    content = value
                    errorMessage = nil
                }
                .frame(
                    maxWidth: .infinity,
                    minHeight: 420,
                    alignment: .topLeading
                )
            }
        }
        .appConfirmationAlert(
            title: "Discard changes?",
            message: "Your unsaved changes will be lost.",
            actionTitle: "Discard",
            actionRole: .destructive,
            cancelTitle: "Keep Editing",
            isPresented: $discardConfirmationPresented
        ) {
            onClosed()
        }
    }

    private var isDirty: Bool {
        title != diary.title
            || content != diary.content
    }

    private var isInvalid: Bool {
        title.trimmingCharacters(
            in: .whitespacesAndNewlines
        ).isEmpty
            || content.trimmingCharacters(
                in: .whitespacesAndNewlines
            ).isEmpty
            || diary.author == nil
    }

    private func requestVeilClose() {
        guard !isSaving else {
            return
        }

        if isDirty {
            discardConfirmationPresented = true
        } else {
            onClosed()
        }
    }

    @MainActor
    private func save() async {
        guard !isSaving,
              let author = diary.author
        else {
            return
        }

        let normalizedTitle = title
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )
        let normalizedContent = content
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )

        guard !normalizedTitle.isEmpty,
              !normalizedContent.isEmpty
        else {
            return
        }

        isSaving = true
        errorMessage = nil
        defer {
            isSaving = false
        }

        do {
            let request = DaySpaceDiaryUpdateRequest(
                title: normalizedTitle,
                content: normalizedContent,
                date: diary.date,
                tags: diary.tags,
                mood: diary.mood,
                author: author
            )
            let body = try JSONEncoder().encode(
                request
            )
            let response: DaySpaceDiaryEnvelope =
                try await appModel.api.request(
                    path: "/api/v1/diary/\(diary.id)",
                    method: "PATCH",
                    body: body
                )
            onSaved(response.data)
            onClosed()
        } catch {
            errorMessage = "保存失败，请重试"
        }
    }
}
