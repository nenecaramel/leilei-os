import SwiftUI
import UIKit

struct DiaryCommentEditorSheet: View {
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

struct DiaryEditorFields: View {
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

struct DiaryCreateView: View {
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
