import SwiftUI
import UIKit

let daySpaceStateHeight: CGFloat = 470

struct DaySpaceView: View {
    @EnvironmentObject private var appModel: AppModel

    let target: DaySpaceNavigationTarget?
    let onTargetConsumed: () -> Void

    @State private var memoryRevision = 0
    @State private var memoryState: DaySpaceModuleState<[MindProductItem]> = .loading(nil)
    @State private var query = ""
    @State private var searchState: DaySpaceTodoSearchState = .idle
    @State private var completeTodoSearch:
        [DaySpaceTodoSearchEntry]?
    @State private var searchHasMore = false
    @State private var isLoadingMoreSearch = false
    @State private var selectedDate: String?
    @State private var discoveryState: DaySpaceDiscoveryState = .loading
    @State private var discoveryIncomplete = false
    @State private var todoState: DaySpaceModuleState<DaySpaceTodoDay> = .loading(nil)
    @State private var diaryState: DaySpaceModuleState<[DaySpaceDiary]> = .loading(nil)
    @State private var selection: DaySpacePaperSelection?
    @State private var createSelection: DaySpaceTodoCreateSelection?
    @State private var datePickerPresented = false
    @State private var datePickerDraft = Date.now
    @State private var generation = 0

    var body: some View {
        Group {
            if isSearching {
                searchContent
            } else {
                DaySpaceContent(
                    memoryState: memoryState,
                    onRetryMemory: { memoryRevision += 1 },
                    selectedDate: selectedDate,
                    discoveryState: discoveryState,
                    discoveryIncomplete: discoveryIncomplete,
                    todoState: todoState,
                    diaryState: diaryState,
                    onPrevious: {
                        guard let selectedDate else { return }
                        selectDate(
                            DaySpaceDate.shift(
                                selectedDate,
                                by: -1
                            )
                        )
                    },
                    onSelectDate: {
                        datePickerDraft = selectedDate
                            .flatMap(DaySpaceDate.date)
                            ?? .now
                        datePickerPresented = true
                    },
                    onNext: {
                        guard let selectedDate else { return }
                        selectDate(
                            DaySpaceDate.shift(
                                selectedDate,
                                by: 1
                            )
                        )
                    },
                    onRetryTodo: { date in
                        Task { await retryTodo(for: date) }
                    },
                    onRetryDiary: { date in
                        Task { await retryDiary(for: date) }
                    },
                    onRetryDiscovery: {
                        Task { await discoverAndLoad() }
                    },
                    onRetryDate: { date in
                        Task { await loadDate(date) }
                    },
                    onSelectPaper: { paper in
                        selection = paper
                    }
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .searchable(text: $query, prompt: "Search")
        .toolbar {
            if #available(iOS 26.0, *) {
                DefaultToolbarItem(kind: .search, placement: .bottomBar)

                ToolbarSpacer(.fixed, placement: .bottomBar)

                ToolbarItem(placement: .bottomBar) {
                    Button {
                        guard let selectedDate else {
                            return
                        }

                        createSelection = DaySpaceTodoCreateSelection(
                            date: selectedDate,
                            unavailableAuthors: unavailableTodoAuthors
                        )
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .accessibilityLabel("New Todo")
                    .disabled(!canCreateTodo)
                }
            }
        }
        .sheet(isPresented: $datePickerPresented) {
            DaySpaceDatePickerSheet(
                date: $datePickerDraft
            ) {
                selectDate(DaySpaceDate.businessDate(datePickerDraft))
            }
        }
        .fullScreenCover(item: $createSelection) { draft in
            DaySpaceTodoPaperDetail(
                date: draft.date,
                unavailableAuthors: draft.unavailableAuthors,
                onSaved: { committed in
                    applyTodo(committed)
                    Task {
                        await refreshTodoAfterSave(
                            date: committed.date,
                            committed: committed
                        )
                    }
                },
                onClosed: {
                    createSelection = nil
                }
            )
            .presentationBackground(.clear)
            .interactiveDismissDisabled()
        }
        .fullScreenCover(item: $selection) { paper in
            Group {
                switch paper {
                case .todo(let todo):
                    DaySpaceTodoPaperDetail(
                        paper: todo,
                        onSaved: { committed in
                            applyTodo(committed)
                            Task {
                                await refreshTodoAfterSave(
                                    date: committed.date,
                                    committed: committed
                                )
                            }
                        },
                        onClosed: {
                            self.selection = nil
                        }
                    )

                case .memory(let date, let items):
                    DaySpaceMemoryDetail(date: date, items: items, onSaved: applyMemory, onClosed: { selection = nil })
                case .diary(let diary):
                    DaySpaceDiaryPaperDetail(
                        diary: diary,
                        onSaved: { committed in
                            applyDiary(committed)
                            Task {
                                await refreshDiaryAfterSave(
                                    date: committed.date,
                                    committed: committed
                                )
                            }
                        },
                        onClosed: {
                            self.selection = nil
                        }
                    )
                }
            }
            .presentationBackground(.clear)
            .interactiveDismissDisabled()
        }
        .task(id: target) {
            if let target {
                await openExternalTarget(target)
            } else if selectedDate == nil {
                await discoverAndLoad()
            }
        }
        .task(id: "\(selectedDate ?? ""):\(memoryRevision)") {
            guard let date = selectedDate else { memoryState = .loading(nil); return }
            memoryState = .loading(memoryState.value)
            do {
                let items = try await appModel.api.memoryDay(date)
                try Task.checkCancellation()
                if selectedDate == date { memoryState = .ready(items) }
            } catch { if !Task.isCancelled { memoryState = .error(memoryState.value) } }
        }
        .task(id: query) {
            await searchTodoIfNeeded()
        }
    }

    private var isSearching: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    @ViewBuilder
    private var searchContent: some View {
        DaySpaceSearchContent(
            searchState: searchState,
            searchHasMore: searchHasMore,
            isLoadingMoreSearch: isLoadingMoreSearch,
            onOpenResult: { entry in
                Task { await openSearchResult(entry) }
            },
            onLoadMore: {
                Task { await loadMoreTodoSearch() }
            },
            onRetry: {
                Task { await searchTodoIfNeeded() }
            }
        )
    }

    private var unavailableTodoAuthors: [DaySpaceAuthor] {
        guard let day = todoState.value else {
            return []
        }

        return DaySpaceAuthor.allCases.filter { author in
            day.papers[author] != nil
        }
    }

    private var canCreateTodo: Bool {
        selectedDate != nil
            && todoState.value != nil
            && unavailableTodoAuthors.count < DaySpaceAuthor.allCases.count
    }

    private func selectDate(_ date: String) {
        Task {
            await loadDate(date)
        }
    }

    @MainActor
    private func openExternalTarget(
        _ target: DaySpaceNavigationTarget
    ) async {
        query = ""
        searchState = .idle
        discoveryState = .ready

        await loadDate(target.date)

        defer {
            onTargetConsumed()
        }

        guard let authorRaw = target.author,
              let author = DaySpaceAuthor(
                  rawValue: authorRaw
              ),
              let day = todoState.value,
              let paper = day.papers[author]
        else {
            return
        }

        selection = .todo(paper)
    }

    @MainActor
    private func searchTodoIfNeeded() async {
        let normalized = query.trimmingCharacters(
            in: .whitespacesAndNewlines
        )

        guard !normalized.isEmpty else {
            searchState = .idle
            completeTodoSearch = nil
            searchHasMore = false
            isLoadingMoreSearch = false
            return
        }

        searchState = .loading
        completeTodoSearch = nil
        searchHasMore = false
        isLoadingMoreSearch = false

        do {
            try await Task.sleep(for: .milliseconds(250))
            try Task.checkCancellation()

            let response: DaySpaceTodoSearchEnvelope =
                try await appModel.api.request(
                    path: DaySpaceTodoSearchSupport.todoSearchPath(for: normalized)
                )

            try Task.checkCancellation()

            let firstPage = Array(
                response.data.entries.prefix(50)
            )
            searchHasMore =
                response.data.entries.count > firstPage.count
            searchState = firstPage.isEmpty
                ? .noResults
                : .results(firstPage)
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            searchState = .unavailable
        }
    }

    @MainActor
    private func loadMoreTodoSearch() async {
        guard !isLoadingMoreSearch,
              searchHasMore,
              case .results(let visible) = searchState else {
            return
        }

        let normalizedQuery = query.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !normalizedQuery.isEmpty else {
            return
        }

        isLoadingMoreSearch = true
        defer { isLoadingMoreSearch = false }

        do {
            let all: [DaySpaceTodoSearchEntry]
            if let completeTodoSearch {
                all = completeTodoSearch
            } else {
                let data = try await appModel.api.exportData()
                let snapshot = try JSONDecoder().decode(
                    LeileiExportSnapshot.self,
                    from: data
                )
                all = DaySpaceTodoSearchSupport.completeTodoSearchResults(
                    papers: snapshot.data.todo ?? [],
                    query: normalizedQuery
                )
            }

            guard normalizedQuery
                    == query.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    ) else {
                return
            }

            completeTodoSearch = all

            let nextCount = min(
                visible.count + 50,
                all.count
            )
            searchState = .results(
                Array(all.prefix(nextCount))
            )
            searchHasMore = nextCount < all.count
        } catch {
            // Preserve the current search results.
        }
    }

    @MainActor
    private func openSearchResult(
        _ entry: DaySpaceTodoSearchEntry
    ) async {
        query = ""
        searchState = .idle
        await loadDate(entry.date)

        guard let day = todoState.value,
              let paper = day.papers[entry.author]
        else {
            return
        }

        selection = .todo(paper)
    }

    @MainActor
    private func discoverAndLoad() async {
        discoveryState = .loading
        discoveryIncomplete = false
        selectedDate = nil
        todoState = .loading(nil)
        diaryState = .loading(nil)

        async let todoDates = readDates(path: "/api/v1/todo/dates")
        async let diaryDates = readDates(path: "/api/v1/diary/dates")
        async let memoryDates = readDates(path: "/api/v1/mind/dates")

        let todoResult = await todoDates
        let diaryResult = await diaryDates
        let memoryResult = await memoryDates

        let todoSucceeded = todoResult != nil
        let diarySucceeded = diaryResult != nil

        guard todoSucceeded || diarySucceeded || memoryResult != nil else {
            discoveryState = .unavailable
            return
        }

        discoveryIncomplete = !(todoSucceeded && diarySucceeded && memoryResult != nil)

        let today = DaySpaceDate.businessDate(.now)
        let latest = ((todoResult ?? []) + (diaryResult ?? []) + (memoryResult ?? []))
            .filter(DaySpaceDate.isValid)
            .max()
            ?? today

        discoveryState = .ready
        await loadDate(latest)
    }

    @MainActor
    private func readDates(path: String) async -> [String]? {
        do {
            let response: DaySpaceDatesEnvelope = try await appModel.api.request(
                path: path
            )
            return response.data.dates
        } catch {
            return nil
        }
    }

    @MainActor
    private func loadDate(_ date: String) async {
        guard DaySpaceDate.isValid(date) else { return }

        generation += 1
        let requestGeneration = generation

        selectedDate = date
        selection = nil
        memoryState = .loading(nil)
        memoryRevision += 1
        todoState = .loading(nil)
        diaryState = .loading(nil)

        async let todo = readTodo(date: date)
        async let diaries = readDiaries(date: date)

        let todoResult = await todo
        let diaryResult = await diaries

        guard requestGeneration == generation,
              selectedDate == date
        else {
            return
        }

        switch todoResult {
        case .success(let day):
            todoState = .ready(day)
        case .failure:
            todoState = .error(todoState.value)
        }

        switch diaryResult {
        case .success(let entries):
            diaryState = .ready(entries)
        case .failure:
            diaryState = .error(diaryState.value)
        }
    }

    @MainActor
    private func applyMemory(_ updated: [MindProductItem]) {
        guard let selectedDate else { return }
        let replacements = Dictionary(uniqueKeysWithValues: updated.map { ($0.id, $0) })
        let items = (memoryState.value ?? []).compactMap { original -> MindProductItem? in
            let item = replacements[original.id] ?? original
            guard let instant = MemoryDate.parse(item.occurredAt), DaySpaceDate.businessDate(instant) == selectedDate else { return nil }
            return item
        }
        memoryState = .ready(items)
        memoryRevision += 1
    }

    @MainActor
    private func retryTodo(for date: String) async {
        guard selectedDate == date else { return }

        todoState = .loading(todoState.value)
        let result = await readTodo(date: date)

        guard selectedDate == date else { return }

        switch result {
        case .success(let day):
            todoState = .ready(day)
        case .failure:
            todoState = .error(todoState.value)
        }
    }

    @MainActor
    private func retryDiary(for date: String) async {
        guard selectedDate == date else { return }

        diaryState = .loading(diaryState.value)
        let result = await readDiaries(date: date)

        guard selectedDate == date else { return }

        switch result {
        case .success(let entries):
            diaryState = .ready(entries)
        case .failure:
            diaryState = .error(diaryState.value)
        }
    }

    @MainActor
    private func readTodo(
        date: String
    ) async -> Result<DaySpaceTodoDay, Error> {
        do {
            let response: DaySpaceTodoDayEnvelope = try await appModel.api.request(
                path: "/api/v1/todo/\(date)"
            )
            return .success(response.data)
        } catch {
            return .failure(error)
        }
    }

    @MainActor
    private func readDiaries(
        date: String
    ) async -> Result<[DaySpaceDiary], Error> {
        do {
            let response: DaySpaceDiaryDayEnvelope = try await appModel.api.request(
                path: "/api/v1/diary/by-date/\(date)"
            )
            return .success(response.data.diaries)
        } catch {
            return .failure(error)
        }
    }

    @MainActor
    private func refreshTodoAfterSave(
        date: String,
        committed: DaySpaceTodoPaper
    ) async {
        guard selectedDate == date else { return }

        let result = await readTodo(date: date)

        guard selectedDate == date else { return }

        switch result {
        case .success(let day):
            todoState = .ready(day)

        case .failure:
            var current = todoState.value
                ?? DaySpaceTodoDay(
                    date: date,
                    papers: DaySpaceTodoPapers(
                        L: nil,
                        G: nil,
                        C: nil
                    )
                )
            current.setPaper(
                committed.entries.isEmpty ? nil : committed,
                for: committed.author
            )
            todoState = .error(current)
        }
    }

    @MainActor
    private func refreshDiaryAfterSave(
        date: String,
        committed: DaySpaceDiary
    ) async {
        guard selectedDate == date else { return }

        let result = await readDiaries(date: date)

        guard selectedDate == date else { return }

        switch result {
        case .success(let diaries):
            diaryState = .ready(diaries)

        case .failure:
            var diaries = diaryState.value ?? []
            if let index = diaries.firstIndex(
                where: { $0.id == committed.id }
            ) {
                diaries[index] = committed
            } else {
                diaries.append(committed)
            }
            diaryState = .error(diaries)
        }
    }

    private func applyTodo(_ paper: DaySpaceTodoPaper) {
        guard let current = todoState.value else { return }

        var next = current
        next.setPaper(
            paper.entries.isEmpty ? nil : paper,
            for: paper.author
        )
        todoState = .ready(next)
    }

    private func applyDiary(_ diary: DaySpaceDiary) {
        var diaries = diaryState.value ?? []

        if let index = diaries.firstIndex(where: { $0.id == diary.id }) {
            diaries[index] = diary
        } else {
            diaries.append(diary)
        }

        diaryState = .ready(diaries)
    }
}
