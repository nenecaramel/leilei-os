import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct UniverseDiarySourceSheet: View {
    let source: UniverseDiarySourceSummary
    let onChanged: () async -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if source.status == "archived" {
                    DiaryArchivedDetailView(
                        diaryID: source.diaryId,
                        onChanged: {
                            Task {
                                await onChanged()
                            }
                        }
                    )
                } else {
                    DiaryDetailView(
                        diaryID: source.diaryId,
                        onChanged: {
                            Task {
                                await onChanged()
                            }
                        }
                    )
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("Close diary")
                }
            }
        }
    }
}

struct UniverseDiarySourcePicker: View {
    let initialSelection: [String]
    let initialMetadata:
        [String: UniverseDiarySourceOption]
    let search:
        (String) async throws -> [UniverseDiarySourceOption]
    let onDone:
        (
            [String],
            [String: UniverseDiarySourceOption]
        ) -> Void

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appModel: AppModel

    @State private var query = ""
    @State private var discardPresented = false
    @State private var selected:
        Set<String>
    @State private var metadata:
        [String: UniverseDiarySourceOption]
    @State private var results:
        [UniverseDiarySourceOption] = []
    @State private var completeResults:
        [UniverseDiarySourceOption]?
    @State private var hasMore = false
    @State private var isLoadingMore = false
    @State private var state:
        PickerState = .loading

    init(
        initialSelection: [String],
        initialMetadata:
            [String: UniverseDiarySourceOption],
        search:
            @escaping (String) async throws
                -> [UniverseDiarySourceOption],
        onDone:
            @escaping (
                [String],
                [String: UniverseDiarySourceOption]
            ) -> Void
    ) {
        self.initialSelection = initialSelection
        self.initialMetadata = initialMetadata
        self.search = search
        self.onDone = onDone
        _selected = State(
            initialValue: Set(initialSelection)
        )
        _metadata = State(
            initialValue: initialMetadata
        )
    }

    var body: some View {
        NavigationStack {
            Group {
                switch state {
                case .loading:
                    ProgressView()
                        .frame(
                            maxWidth: .infinity,
                            maxHeight: .infinity
                        )

                case .ready:
                    List {
                        ForEach(results) { option in
                            Button {
                                if selected.contains(
                                    option.id
                                ) {
                                    selected.remove(
                                        option.id
                                    )
                                } else {
                                    selected.insert(
                                        option.id
                                    )
                                }
                                metadata[option.id] =
                                    option
                            } label: {
                                HStack(spacing: 10) {
                                    VStack(
                                        alignment: .leading,
                                        spacing: 2
                                    ) {
                                        Text(option.title)
                                            .foregroundStyle(
                                                .primary
                                            )
                                        Text(
                                            option.date
                                        )
                                        .font(.caption)
                                        .foregroundStyle(
                                            .secondary
                                        )
                                    }

                                    Spacer()

                                    if option.status
                                        == "archived" {
                                        Text("Archived")
                                            .font(.caption2)
                                            .foregroundStyle(
                                                .secondary
                                            )
                                    }

                                    if selected.contains(
                                        option.id
                                    ) {
                                        Image(
                                            systemName:
                                                "checkmark"
                                        )
                                        .font(.caption.weight(.semibold))
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                        }

                        if hasMore {
                            Button {
                                Task {
                                    await loadMore()
                                }
                            } label: {
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
                            .buttonStyle(.plain)
                            .disabled(isLoadingMore)
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(
                        .hidden
                    )

                case .unavailable:
                    AppStateSurface(
                        title: "Unavailable",
                        actionTitle: "Retry"
                    ) {
                        Task {
                            await load()
                        }
                    }
                }
            }
            .background(
                UniversePalette.background
                    .ignoresSafeArea()
            )
            .navigationTitle(
                "Select Source Diaries"
            )
            .navigationBarTitleDisplayMode(
                .inline
            )
            .searchable(
                text: $query,
                prompt: "Search title, date, or tags"
            )
            .toolbar {
                ToolbarItem(
                    placement: .cancellationAction
                ) {
                    Button("Cancel") {
                        cancelSelection()
                    }
                }

                ToolbarItem(
                    placement: .confirmationAction
                ) {
                    Button("Done") {
                        let originalIDs = Set(initialSelection)
                        let retained = initialSelection.filter {
                            selected.contains($0)
                        }
                        let added = selected.subtracting(originalIDs)
                            .sorted { left, right in
                                let leftDate = metadata[left]?.date ?? ""
                                let rightDate = metadata[right]?.date ?? ""
                                if leftDate != rightDate {
                                    return leftDate < rightDate
                                }
                                return left < right
                            }
                        let ordered = retained + added

                        onDone(
                            ordered,
                            metadata
                        )
                        dismiss()
                    }
                }
            }
            .task(id: query) {
                try? await Task.sleep(
                    for: .milliseconds(250)
                )
                guard !Task.isCancelled else {
                    return
                }
                await load()
            }
        }
        .interactiveDismissDisabled(hasUnsavedChanges)
        .appConfirmationAlert(
            title: "Discard changes?",
            message: "Your unsaved changes will be lost.",
            actionTitle: "Discard",
            actionRole: .destructive,
            cancelTitle: "Keep Editing",
            isPresented: $discardPresented
        ) {
            dismiss()
        }
    }

    private var hasUnsavedChanges: Bool {
        selected != Set(initialSelection)
    }

    private func cancelSelection() {
        if hasUnsavedChanges {
            discardPresented = true
        } else {
            dismiss()
        }
    }

    private func load() async {
        state = .loading
        completeResults = nil
        hasMore = false
        isLoadingMore = false

        do {
            let response =
                try await search(query)
            guard !Task.isCancelled else {
                return
            }

            results = response
            hasMore = response.count == 100
            for option in response {
                metadata[option.id] = option
            }
            state = .ready
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else {
                return
            }
            state = .unavailable
        }
    }

    @MainActor
    private func loadMore() async {
        guard hasMore,
              !isLoadingMore else {
            return
        }

        let currentQuery = query
        isLoadingMore = true
        defer { isLoadingMore = false }

        do {
            let all: [UniverseDiarySourceOption]
            if let completeResults {
                all = completeResults
            } else {
                let data = try await appModel.api.exportData()
                let snapshot = try JSONDecoder().decode(
                    LeileiExportSnapshot.self,
                    from: data
                )

                let normalized = currentQuery
                    .trimmingCharacters(
                        in: .whitespacesAndNewlines
                    )
                    .lowercased()

                all = (snapshot.data.diary ?? [])
                    .filter { diary in
                        guard !normalized.isEmpty else {
                            return true
                        }

                        return diary.title
                            .lowercased()
                            .contains(normalized)
                            || diary.date
                                .contains(normalized)
                            || diary.tags.contains {
                                $0.lowercased()
                                    .contains(normalized)
                            }
                    }
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
                        UniverseDiarySourceOption(
                            id: $0.id,
                            title: $0.title,
                            date: $0.date,
                            status: $0.status
                        )
                    }
            }

            guard currentQuery == query else {
                return
            }

            completeResults = all

            let nextCount = min(
                results.count + 100,
                all.count
            )
            results = Array(
                all.prefix(nextCount)
            )
            hasMore = nextCount < all.count

            for option in results {
                metadata[option.id] = option
            }
        } catch {
            // Keep the already loaded source options visible.
        }
    }

    private enum PickerState {
        case loading
        case ready
        case unavailable
    }
}
