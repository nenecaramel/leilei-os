import SwiftUI
import UIKit

private let daySpaceStateHeight: CGFloat = 470

struct DaySpaceView: View {
    @EnvironmentObject private var appModel: AppModel

    @State private var query = ""
    @State private var searchState: DaySpaceTodoSearchState = .idle
    @State private var selectedDate: String?
    @State private var discoveryState: DaySpaceDiscoveryState = .loading
    @State private var discoveryIncomplete = false
    @State private var todoState: DaySpaceModuleState<DaySpaceTodoDay> = .loading(nil)
    @State private var diaryState: DaySpaceModuleState<[DaySpaceDiary]> = .loading(nil)
    @State private var selection: DaySpacePaperSelection?
    @State private var datePickerPresented = false
    @State private var datePickerDraft = Date.now
    @State private var generation = 0

    var body: some View {
        Group {
            if isSearching {
                searchContent
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                DaySpaceDateNavigationRow(
                    selectedDate: selectedDate,
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
                    }
                )
                .padding(.bottom, 8)

                if discoveryIncomplete, selectedDate != nil {
                    DaySpaceWarning(
                        text: "Unavailable"
                    )
                    .padding(.bottom, 8)
                }

                if let selectedDate,
                   hasPartialFailure,
                   !bothModulesFailed {
                    DaySpacePartialFailure(
                        todoFailed: todoState.isError,
                        diaryFailed: diaryState.isError,
                        onRetryTodo: {
                            Task {
                                await retryTodo(for: selectedDate)
                            }
                        },
                        onRetryDiary: {
                            Task {
                                await retryDiary(for: selectedDate)
                            }
                        }
                    )
                    .padding(.bottom, 8)
                }

                        content
                    }
                    .frame(maxWidth: 860)
                    .padding(.horizontal, 24)
                    .padding(.top, 8)
                    .padding(.bottom, 28)
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .searchable(text: $query, prompt: "Search")
        .toolbar {
            if #available(iOS 26.0, *) {
                DefaultToolbarItem(kind: .search, placement: .bottomBar)
            }
        }
        .sheet(isPresented: $datePickerPresented) {
            DaySpaceDatePickerSheet(
                date: $datePickerDraft
            ) {
                selectDate(DaySpaceDate.businessDate(datePickerDraft))
            }
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
        .task {
            await discoverAndLoad()
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
        switch searchState {
        case .idle, .loading:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)

        case .results(let entries):
            List(entries) { entry in
                Button {
                    Task {
                        await openSearchResult(entry)
                    }
                } label: {
                    DaySpaceTodoSearchRow(entry: entry)
                }
                .buttonStyle(.plain)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Color(.systemBackground))

        case .noResults:
            AppStateSurface(title: "Nothing here")
                .frame(maxWidth: .infinity, maxHeight: .infinity)

        case .unavailable:
            AppStateSurface(
                title: "Unavailable",
                actionTitle: "Retry"
            ) {
                Task {
                    await searchTodoIfNeeded()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private var content: some View {
        if discoveryState == .loading, selectedDate == nil {
            DaySpaceReadingState()
        } else if discoveryState == .unavailable {
            AppStateSurface(
                title: "Unavailable",
                actionTitle: "Retry"
            ) {
                Task {
                    await discoverAndLoad()
                }
            }
            .frame(
                maxWidth: .infinity,
                minHeight: daySpaceStateHeight,
                alignment: .center
            )
        } else if let selectedDate {
            let papers = currentPapers

            if bothModulesFailed {
                AppStateSurface(
                    title: "Unavailable",
                    actionTitle: "Retry"
                ) {
                    Task {
                        await loadDate(selectedDate)
                    }
                }
                .frame(
                    maxWidth: .infinity,
                    minHeight: daySpaceStateHeight,
                    alignment: .center
                )
            } else if todoState.isLoading && diaryState.isLoading && papers.isEmpty {
                DaySpaceReadingState()
            } else if completeEmpty {
                AppStateSurface(
                    title: "Nothing here",
                )
                .frame(
                    maxWidth: .infinity,
                    minHeight: daySpaceStateHeight,
                    alignment: .center
                )
            } else if !papers.isEmpty {
                DaySpaceStage(
                    dateKey: selectedDate,
                    papers: papers
                ) { paper in
                    selection = paper
                }
            }
        }
    }

    private var hasPartialFailure: Bool {
        todoState.isError || diaryState.isError
    }

    private var bothModulesFailed: Bool {
        todoState.isErrorWithoutValue && diaryState.isErrorWithoutValue
    }

    private var completeEmpty: Bool {
        guard case .ready(let todo) = todoState,
              case .ready(let diaries) = diaryState
        else {
            return false
        }

        return todo.visiblePapers.isEmpty && diaries.isEmpty
    }

    private var currentPapers: [DaySpacePaperSelection] {
        var result: [DaySpacePaperSelection] = []

        if let todo = todoState.value {
            result.append(contentsOf: todo.visiblePapers.map {
                .todo($0)
            })
        }

        if let diaries = diaryState.value {
            result.append(contentsOf: diaries.map {
                .diary($0)
            })
        }

        return result
    }

    private func selectDate(_ date: String) {
        Task {
            await loadDate(date)
        }
    }

    @MainActor
    private func searchTodoIfNeeded() async {
        let normalized = query.trimmingCharacters(
            in: .whitespacesAndNewlines
        )

        guard !normalized.isEmpty else {
            searchState = .idle
            return
        }

        searchState = .loading

        do {
            try await Task.sleep(for: .milliseconds(250))
            try Task.checkCancellation()

            let response: DaySpaceTodoSearchEnvelope =
                try await appModel.api.request(
                    path: todoSearchPath(for: normalized)
                )

            try Task.checkCancellation()
            searchState = response.data.entries.isEmpty
                ? .noResults
                : .results(response.data.entries)
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            searchState = .unavailable
        }
    }

    private func todoSearchPath(for query: String) -> String {
        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "query", value: query),
            URLQueryItem(name: "limit", value: "51"),
        ]
        return "/api/v1/todo/search?\(components.percentEncodedQuery ?? "")"
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

        let todoResult = await todoDates
        let diaryResult = await diaryDates

        let todoSucceeded = todoResult != nil
        let diarySucceeded = diaryResult != nil

        guard todoSucceeded || diarySucceeded else {
            discoveryState = .unavailable
            return
        }

        discoveryIncomplete = !(todoSucceeded && diarySucceeded)

        let today = DaySpaceDate.businessDate(.now)
        let latest = ((todoResult ?? []) + (diaryResult ?? []))
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

private enum DaySpaceTodoSearchState {
    case idle
    case loading
    case results([DaySpaceTodoSearchEntry])
    case noResults
    case unavailable
}

private struct DaySpaceTodoSearchEnvelope: Decodable {
    let success: Bool
    let data: DaySpaceTodoSearchData
}

private struct DaySpaceTodoSearchData: Decodable {
    let entries: [DaySpaceTodoSearchEntry]
    let metadata: DaySpaceTodoSearchMetadata
}

private struct DaySpaceTodoSearchMetadata: Decodable {
    let count: Int
    let author: DaySpaceAuthor?
}

private struct DaySpaceTodoSearchEntry: Decodable, Identifiable {
    let entryID: String
    let date: String
    let author: DaySpaceAuthor
    let kind: DaySpaceTodoEntryKind
    let text: String
    let snippet: String

    var id: String {
        "\(date):\(author.rawValue):\(entryID)"
    }

    enum CodingKeys: String, CodingKey {
        case date
        case author
        case kind
        case text
        case snippet
        case entryID = "entry_id"
    }
}

private struct DaySpaceTodoSearchRow: View {
    let entry: DaySpaceTodoSearchEntry

    private var metadataText: String {
        "\(entry.author.rawValue)  \(entry.kind.rawValue.capitalized)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(entry.text)
                .font(.body.weight(.semibold))
                .lineLimit(1)

            HStack(spacing: 12) {
                Text(DaySpaceDate.rowLabel(entry.date))
                    .fixedSize(horizontal: true, vertical: false)

                Spacer(minLength: 8)

                Text(metadataText)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}

private struct DaySpaceDateNavigationRow: View {
    let selectedDate: String?
    let onPrevious: () -> Void
    let onSelectDate: () -> Void
    let onNext: () -> Void

    var body: some View {
        HStack(spacing: 5) {
            Button(action: onPrevious) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 15, weight: .regular))
                    .frame(width: 32, height: 34)
            }
            .buttonStyle(.plain)
            .disabled(selectedDate == nil)
            .accessibilityLabel("Previous Day")

            Button(action: onSelectDate) {
                Text(
                    selectedDate.map(DaySpaceDate.fullLabel)
                        ?? "Loading…"
                )
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(.secondary)
                .frame(minWidth: 138, minHeight: 34)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(selectedDate == nil)
            .accessibilityLabel("Choose Day Space date")

            Button(action: onNext) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 15, weight: .regular))
                    .frame(width: 32, height: 34)
            }
            .buttonStyle(.plain)
            .disabled(selectedDate == nil)
            .accessibilityLabel("Next Day")
        }
        .frame(maxWidth: .infinity)
    }
}

private struct DaySpaceReadingState: View {
    var body: some View {
        GeometryReader { proxy in
            let width = max(280, proxy.size.width)

            ZStack(alignment: .topLeading) {
                DaySpaceSkeletonPaper(width: min(158, width * 0.46), height: 112)
                    .rotationEffect(.degrees(-2.4))
                    .offset(x: 6, y: 18)

                DaySpaceSkeletonPaper(width: min(186, width * 0.55), height: 134)
                    .rotationEffect(.degrees(2.1))
                    .offset(x: max(0, width - min(186, width * 0.55) - 4), y: 128)

                DaySpaceSkeletonPaper(width: min(218, width * 0.64), height: 158)
                    .rotationEffect(.degrees(-1.6))
                    .offset(x: max(0, (width - min(218, width * 0.64)) * 0.3), y: 270)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .frame(height: daySpaceStateHeight)
        .accessibilityLabel("Loading…")
    }
}

private struct DaySpaceSkeletonPaper: View {
    let width: CGFloat
    let height: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.primary.opacity(0.08))
                .frame(width: width * 0.58, height: 10)

            RoundedRectangle(cornerRadius: 4)
                .fill(Color.primary.opacity(0.06))
                .frame(width: width * 0.78, height: 8)

            RoundedRectangle(cornerRadius: 4)
                .fill(Color.primary.opacity(0.06))
                .frame(width: width * 0.66, height: 8)
        }
        .padding(.horizontal, 14)
        .padding(.top, 15)
        .frame(width: width, height: height, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(Color(.systemBackground))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(Color.primary.opacity(0.08), lineWidth: 1)
        )
        .shadow(
            color: .black.opacity(0.04),
            radius: 10,
            y: 7
        )
    }
}

private struct DaySpaceWarning: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
    }
}

private struct DaySpacePartialFailure: View {
    let todoFailed: Bool
    let diaryFailed: Bool
    let onRetryTodo: () -> Void
    let onRetryDiary: () -> Void

    var body: some View {
        VStack(spacing: 6) {
            Text("Unavailable")
                .font(.caption)
            .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                if todoFailed {
                    Button("Retry Todo", action: onRetryTodo)
                }

                if diaryFailed {
                    Button("Retry Diary", action: onRetryDiary)
                }
            }
            .font(.caption.weight(.medium))
        }
        .frame(maxWidth: .infinity)
    }
}

private struct DaySpaceDatePickerSheet: View {
    @Binding var date: Date
    let onDone: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            DatePicker(
                "Date",
                selection: $date,
                displayedComponents: .date
            )
            .datePickerStyle(.graphical)
            .padding()
            .navigationTitle("Choose Date")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        onDone()
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

private struct DaySpaceStage: View {
    let dateKey: String
    let papers: [DaySpacePaperSelection]
    let onSelect: (DaySpacePaperSelection) -> Void

    @State private var stageWidth: CGFloat = 345

    var body: some View {
        let layout = DaySpaceLayout.layout(
            dateKey: dateKey,
            papers: papers,
            rawStageWidth: stageWidth
        )

        ZStack(alignment: .topLeading) {
            ForEach(papers) { paper in
                if let item = layout.itemsByID[paper.id] {
                    Button {
                        onSelect(paper)
                    } label: {
                        DaySpacePaperCard(
                            paper: paper,
                            size: item.size
                        )
                    }
                    .buttonStyle(.plain)
                    .frame(
                        width: item.width,
                        height: item.height
                    )
                    .rotationEffect(.degrees(item.rotation))
                    .position(
                        x: item.left + item.width / 2,
                        y: item.top + item.height / 2
                    )
                    .zIndex(Double(item.zIndex))
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: layout.stageHeight)
        .background {
            GeometryReader { proxy in
                Color.clear
                    .onAppear {
                        stageWidth = max(280, proxy.size.width)
                    }
                    .onChange(of: proxy.size.width) { _, width in
                        stageWidth = max(280, width)
                    }
            }
        }
    }
}

private struct DaySpacePaperCard: View {
    let paper: DaySpacePaperSelection
    let size: DaySpacePaperSize

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            VStack(alignment: .leading, spacing: 0) {
                switch paper {
                case .todo(let todo):
                    DaySpaceTodoPreview(
                        paper: todo,
                        size: size
                    )

                case .diary(let diary):
                    DaySpaceDiaryPreview(
                        diary: diary,
                        size: size
                    )
                }

                Spacer(minLength: 0)
            }
            .frame(
                maxWidth: .infinity,
                maxHeight: .infinity,
                alignment: .topLeading
            )
            .padding(.horizontal, 14)
            .padding(.top, 15)
            .padding(.bottom, 24)

            Text(paper.authorLabel)
                .font(.system(size: 13, design: .serif).italic())
                .foregroundStyle(.secondary)
                .padding(.trailing, 10)
                .padding(.bottom, 7)
        }
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(Color(.systemBackground))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(Color.primary.opacity(0.105), lineWidth: 1)
        )
        .shadow(
            color: .black.opacity(0.055),
            radius: 11,
            y: 8
        )
        .contentShape(Rectangle())
    }
}

private struct DaySpaceTodoPreview: View {
    let paper: DaySpaceTodoPaper
    let size: DaySpacePaperSize

    private var previewLimit: Int {
        switch size {
        case .small:
            return 2
        case .medium:
            return 3
        case .large:
            return 4
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(paper.entries.prefix(previewLimit)) { entry in
                HStack(alignment: .top, spacing: 6) {
                    DaySpaceTodoMark(kind: entry.kind)
                        .frame(width: 8, height: 8)
                        .padding(.top, 3)

                    Text(entry.text)
                        .font(.system(size: 10.5))
                        .foregroundStyle(
                            entry.kind == .completed
                                ? Color.secondary.opacity(0.6)
                                : Color.secondary
                        )
                        .strikethrough(entry.kind == .completed)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .frame(
                            maxWidth: .infinity,
                            alignment: .leading
                        )
                }
            }

            if paper.entries.count > previewLimit {
                Text("...")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
            }
        }
    }
}

private struct DaySpaceTodoMark: View {
    let kind: DaySpaceTodoEntryKind

    var body: some View {
        switch kind {
        case .record:
            Circle()
                .fill(Color.secondary)
                .frame(width: 5, height: 5)

        case .pending:
            Circle()
                .stroke(Color.secondary, lineWidth: 1)
                .frame(width: 5, height: 5)

        case .completed:
            Circle()
                .fill(Color.secondary)
                .frame(width: 5, height: 5)
        }
    }
}

private struct DaySpaceDiaryPreview: View {
    let diary: DaySpaceDiary
    let size: DaySpacePaperSize

    private var contentLines: Int {
        switch size {
        case .small:
            return 3
        case .medium:
            return 4
        case .large:
            return 5
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(diary.title)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.primary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)

            Text(diary.content)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .lineSpacing(2.6)
                .lineLimit(contentLines)
                .multilineTextAlignment(.leading)
        }
    }
}


private struct DaySpaceTodoPaperDetail: View {
    let paper: DaySpaceTodoPaper
    let onSaved: (DaySpaceTodoPaper) -> Void
    let onClosed: () -> Void

    @EnvironmentObject private var appModel: AppModel

    @State private var rows: [DaySpaceEditableTodoEntry]
    @State private var focusRequest: DaySpaceTodoFocusRequest?
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        paper: DaySpaceTodoPaper,
        onSaved: @escaping (DaySpaceTodoPaper) -> Void,
        onClosed: @escaping () -> Void
    ) {
        self.paper = paper
        self.onSaved = onSaved
        self.onClosed = onClosed
        _rows = State(
            initialValue: DaySpaceEditableTodoEntry.initialRows(
                author: paper.author,
                entries: paper.entries
            )
        )
    }

    var body: some View {
        DaySpacePaperDetailLayer(
            dateLabel: DaySpaceDate.paperLabel(paper.date),
            errorMessage: errorMessage,
            onRequestClose: {
                Task {
                    await requestClose()
                }
            },
            topRight: {
                EmptyView()
            },
            signature: {
                Text(paper.author.rawValue)
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
            }
        ) {
            LazyVStack(spacing: 0) {
                ForEach(rows) { row in
                    HStack(alignment: .top, spacing: 8) {
                        Button {
                            cycleStatus(row.id)
                        } label: {
                            DaySpaceTodoEditorMark(
                                kind: row.kind
                            )
                            .frame(
                                width: 22,
                                height: 30
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Change todo status")

                        DaySpaceTodoLineEditor(
                            text: row.text,
                            kind: row.kind,
                            rowID: row.id,
                            focusRequest: focusRequest,
                            onTextChange: { text in
                                updateText(
                                    rowID: row.id,
                                    text: text
                                )
                            },
                            onSplit: { range in
                                splitRow(
                                    rowID: row.id,
                                    range: range
                                )
                            },
                            onMergePrevious: {
                                mergeWithPrevious(
                                    rowID: row.id
                                )
                            },
                            onMergeNext: {
                                mergeWithNext(
                                    rowID: row.id
                                )
                            },
                            onMovePrevious: {
                                moveToPrevious(
                                    rowID: row.id
                                )
                            },
                            onMoveNext: {
                                moveToNext(
                                    rowID: row.id
                                )
                            },
                            onPasteMultiline: { range, text in
                                pasteMultiline(
                                    rowID: row.id,
                                    range: range,
                                    text: text
                                )
                            }
                        )
                        .padding(.trailing, 4)
                        .frame(
                            maxWidth: .infinity,
                            minHeight: 30,
                            alignment: .topLeading
                        )
                    }
                    .frame(
                        minHeight: 30,
                        alignment: .top
                    )
                    .opacity(row.creation ? 0.58 : 1)
                }
            }
        }
    }

    private var normalizedEntries: [DaySpaceTodoEntry] {
        rows.compactMap { row -> DaySpaceTodoEntry? in
            let text = row.text.trimmingCharacters(
                in: .whitespacesAndNewlines
            )

            guard !text.isEmpty else {
                return nil
            }

            return DaySpaceTodoEntry(
                id: row.id,
                kind: row.kind,
                text: text
            )
        }
    }

    private var isDirty: Bool {
        let current = normalizedEntries

        guard current.count == paper.entries.count else {
            return true
        }

        for (left, right) in zip(
            current,
            paper.entries
        ) {
            if left.id != right.id
                || left.kind != right.kind
                || left.text
                    != right.text.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    ) {
                return true
            }
        }

        return false
    }

    private func cycleStatus(_ rowID: String) {
        guard let index = rowIndex(rowID) else {
            return
        }

        rows[index].kind = rows[index].kind.next
        errorMessage = nil
    }

    private func updateText(
        rowID: String,
        text: String
    ) {
        guard let index = rowIndex(rowID) else {
            return
        }

        rows[index].text = text
        rows[index].creation = text
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            .isEmpty
        normalizeVisibleRows()
        errorMessage = nil
    }

    private func splitRow(
        rowID: String,
        range: NSRange
    ) -> Bool {
        guard let index = rowIndex(rowID) else {
            return false
        }

        let source = rows[index].text as NSString
        guard range.location >= 0,
              NSMaxRange(range) <= source.length
        else {
            return false
        }

        let before = source.substring(
            with: NSRange(
                location: 0,
                length: range.location
            )
        )
        let after = source.substring(
            from: NSMaxRange(range)
        )

        rows[index].text = before
        rows[index].creation = before
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            .isEmpty

        let nextIndex = index + 1
        let targetID: String

        if rows.indices.contains(nextIndex),
           rows[nextIndex].creation,
           rows[nextIndex].text.isEmpty {
            rows[nextIndex].text = after
            rows[nextIndex].creation = after
                .trimmingCharacters(
                    in: .whitespacesAndNewlines
                )
                .isEmpty
            targetID = rows[nextIndex].id
        } else {
            let next = DaySpaceEditableTodoEntry(
                id: UUID().uuidString.lowercased(),
                kind: .pending,
                text: after,
                creation: after
                    .trimmingCharacters(
                        in: .whitespacesAndNewlines
                    )
                    .isEmpty
            )
            rows.insert(
                next,
                at: nextIndex
            )
            targetID = next.id
        }

        normalizeVisibleRows()
        requestFocus(
            rowID: targetID,
            offset: 0
        )
        errorMessage = nil
        return true
    }

    private func mergeWithPrevious(
        rowID: String
    ) -> Bool {
        guard let index = rowIndex(rowID),
              index > 0
        else {
            return false
        }

        let previousIndex = index - 1
        let previousLength = rows[previousIndex]
            .text.utf16.count
        let merged = rows[previousIndex].text
            + rows[index].text

        rows[previousIndex].text = merged
        rows[previousIndex].creation = merged
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            .isEmpty

        let targetID = rows[previousIndex].id
        rows.remove(at: index)
        normalizeVisibleRows()
        requestFocus(
            rowID: targetID,
            offset: previousLength
        )
        errorMessage = nil
        return true
    }

    private func mergeWithNext(
        rowID: String
    ) -> Bool {
        guard let index = rowIndex(rowID),
              rows.indices.contains(index + 1)
        else {
            return false
        }

        let nextIndex = index + 1
        let next = rows[nextIndex]

        if next.creation,
           next.text.isEmpty {
            return true
        }

        let caretOffset = rows[index].text.utf16.count
        rows[index].text += next.text
        rows[index].creation = rows[index].text
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            .isEmpty
        rows.remove(at: nextIndex)
        normalizeVisibleRows()
        requestFocus(
            rowID: rowID,
            offset: caretOffset
        )
        errorMessage = nil
        return true
    }

    private func moveToPrevious(
        rowID: String
    ) -> Bool {
        guard let index = rowIndex(rowID),
              index > 0
        else {
            return false
        }

        let previous = rows[index - 1]
        requestFocus(
            rowID: previous.id,
            offset: previous.text.utf16.count
        )
        return true
    }

    private func moveToNext(
        rowID: String
    ) -> Bool {
        guard let index = rowIndex(rowID),
              rows.indices.contains(index + 1)
        else {
            return false
        }

        requestFocus(
            rowID: rows[index + 1].id,
            offset: 0
        )
        return true
    }

    private func pasteMultiline(
        rowID: String,
        range: NSRange,
        text: String
    ) -> Bool {
        guard text.contains("\n")
                || text.contains("\r"),
              let index = rowIndex(rowID)
        else {
            return false
        }

        let source = rows[index].text as NSString
        guard range.location >= 0,
              NSMaxRange(range) <= source.length
        else {
            return false
        }

        let normalized = text.replacingOccurrences(
            of: "\r\n",
            with: "\n"
        )
        .replacingOccurrences(
            of: "\r",
            with: "\n"
        )

        let lines = normalized.components(
            separatedBy: "\n"
        )

        guard lines.count > 1 else {
            return false
        }

        let prefix = source.substring(
            with: NSRange(
                location: 0,
                length: range.location
            )
        )
        let suffix = source.substring(
            from: NSMaxRange(range)
        )

        rows[index].text = prefix + (lines.first ?? "")
        rows[index].creation = rows[index].text
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            .isEmpty

        var inserted: [DaySpaceEditableTodoEntry] = []

        for lineIndex in 1..<lines.count {
            let line = lines[lineIndex]
            let isLast = lineIndex == lines.count - 1
            let rowText = isLast
                ? line + suffix
                : line

            inserted.append(
                DaySpaceEditableTodoEntry(
                    id: UUID().uuidString.lowercased(),
                    kind: .pending,
                    text: rowText,
                    creation: rowText
                        .trimmingCharacters(
                            in: .whitespacesAndNewlines
                        )
                        .isEmpty
                )
            )
        }

        rows.insert(
            contentsOf: inserted,
            at: index + 1
        )

        if let target = inserted.last {
            requestFocus(
                rowID: target.id,
                offset: (lines.last ?? "").utf16.count
            )
        }

        normalizeVisibleRows()
        errorMessage = nil
        return true
    }

    private func rowIndex(
        _ rowID: String
    ) -> Int? {
        rows.firstIndex {
            $0.id == rowID
        }
    }

    private func requestFocus(
        rowID: String,
        offset: Int
    ) {
        focusRequest = DaySpaceTodoFocusRequest(
            token: UUID(),
            rowID: rowID,
            offset: offset
        )
    }

    private func normalizeVisibleRows() {
        let lastContentIndex = rows.lastIndex {
            !$0.text.trimmingCharacters(
                in: .whitespacesAndNewlines
            ).isEmpty
        }

        let targetCount = max(
            24,
            (lastContentIndex ?? -1) + 2
        )

        while rows.count < targetCount {
            rows.append(
                DaySpaceEditableTodoEntry.creationRow()
            )
        }

        while rows.count > targetCount,
              let last = rows.last,
              last.creation,
              last.text.isEmpty {
            rows.removeLast()
        }
    }

    @MainActor
    private func requestClose() async {
        guard !isSaving else {
            return
        }

        guard isDirty else {
            onClosed()
            return
        }

        await saveAndClose()
    }

    @MainActor
    private func saveAndClose() async {
        guard !isSaving else {
            return
        }

        isSaving = true
        errorMessage = nil
        defer {
            isSaving = false
        }

        do {
            let request = DaySpaceTodoReplaceRequest(
                revision: paper.revision,
                entries: normalizedEntries
            )
            let body = try JSONEncoder().encode(
                request
            )
            let response: DaySpaceTodoPaperEnvelope =
                try await appModel.api.request(
                    path: "/api/v1/todo/\(paper.date)/\(paper.author.rawValue)",
                    method: "PUT",
                    body: body
                )
            onSaved(response.data)
            onClosed()
        } catch LeileiAPIError.backend(
            _,
            let code,
            _
        ) where code == "TODO_PAPER_CONFLICT" {
            errorMessage =
                "这张纸张已在其他设备修改，请重新打开后再保存。"
        } catch {
            errorMessage = "保存失败，请重试"
        }
    }
}

private struct DaySpaceTodoFocusRequest: Equatable {
    let token: UUID
    let rowID: String
    let offset: Int
}

private struct DaySpaceTodoEditorMark: View {
    let kind: DaySpaceTodoEntryKind

    var body: some View {
        ZStack {
            switch kind {
            case .pending:
                Circle()
                    .stroke(
                        Color.black.opacity(0.42),
                        lineWidth: 1
                    )
                    .frame(
                        width: 14,
                        height: 14
                    )

            case .completed:
                Circle()
                    .fill(
                        Color(
                            white: 0.47
                        )
                    )
                    .frame(
                        width: 14,
                        height: 14
                    )

                Image(systemName: "checkmark")
                    .font(
                        .system(
                            size: 8,
                            weight: .semibold
                        )
                    )
                    .foregroundStyle(Color.white)

            case .record:
                Circle()
                    .fill(
                        Color(
                            white: 0.29
                        )
                    )
                    .frame(
                        width: 8,
                        height: 8
                    )
            }
        }
    }
}

private struct DaySpaceTodoLineEditor: UIViewRepresentable {
    let text: String
    let kind: DaySpaceTodoEntryKind
    let rowID: String
    let focusRequest: DaySpaceTodoFocusRequest?
    let onTextChange: (String) -> Void
    let onSplit: (NSRange) -> Bool
    let onMergePrevious: () -> Bool
    let onMergeNext: () -> Bool
    let onMovePrevious: () -> Bool
    let onMoveNext: () -> Bool
    let onPasteMultiline: (NSRange, String) -> Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(
        context: Context
    ) -> DaySpaceTodoNativeTextView {
        let textView = DaySpaceTodoNativeTextView()
        textView.backgroundColor = .clear
        textView.isScrollEnabled = false
        textView.textContainerInset = .zero
        textView.textContainer.lineFragmentPadding = 0
        textView.delegate = context.coordinator
        textView.autocorrectionType = .default
        textView.spellCheckingType = .default
        textView.smartQuotesType = .default
        textView.smartDashesType = .default
        textView.returnKeyType = .default
        textView.setContentCompressionResistancePriority(
            .required,
            for: .vertical
        )
        textView.setContentHuggingPriority(
            .required,
            for: .vertical
        )
        wire(
            textView,
            coordinator: context.coordinator
        )
        applyAppearance(
            to: textView,
            coordinator: context.coordinator
        )
        return textView
    }

    func updateUIView(
        _ textView: DaySpaceTodoNativeTextView,
        context: Context
    ) {
        context.coordinator.parent = self
        wire(
            textView,
            coordinator: context.coordinator
        )
        applyAppearance(
            to: textView,
            coordinator: context.coordinator
        )

        guard let focusRequest,
              focusRequest.rowID == rowID,
              context.coordinator.lastFocusToken
                != focusRequest.token
        else {
            return
        }

        context.coordinator.lastFocusToken =
            focusRequest.token

        let offset = max(
            0,
            min(
                focusRequest.offset,
                text.utf16.count
            )
        )

        DispatchQueue.main.async {
            textView.becomeFirstResponder()
            textView.selectedRange = NSRange(
                location: offset,
                length: 0
            )
        }
    }

    func sizeThatFits(
        _ proposal: ProposedViewSize,
        uiView: DaySpaceTodoNativeTextView,
        context: Context
    ) -> CGSize? {
        guard let width = proposal.width else {
            return nil
        }

        let fitting = uiView.sizeThatFits(
            CGSize(
                width: width,
                height: .greatestFiniteMagnitude
            )
        )

        return CGSize(
            width: width,
            height: max(
                30,
                ceil(fitting.height)
            )
        )
    }

    private func wire(
        _ textView: DaySpaceTodoNativeTextView,
        coordinator: Coordinator
    ) {
        textView.onBackspaceAtStart = {
            coordinator.parent.onMergePrevious()
        }
        textView.onDeleteForwardAtEnd = {
            coordinator.parent.onMergeNext()
        }
        textView.onMovePrevious = {
            coordinator.parent.onMovePrevious()
        }
        textView.onMoveNext = {
            coordinator.parent.onMoveNext()
        }
        textView.onPasteMultiline = {
            range,
            value in
            coordinator.parent.onPasteMultiline(
                range,
                value
            )
        }
    }

    private func applyAppearance(
        to textView: DaySpaceTodoNativeTextView,
        coordinator: Coordinator
    ) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = 30
        paragraph.maximumLineHeight = 30

        let textColor: UIColor = kind == .completed
            ? UIColor(
                white: 0.56,
                alpha: 1
            )
            : UIColor(
                white: 0.09,
                alpha: 1
            )

        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(
                ofSize: 14
            ),
            .foregroundColor: textColor,
            .paragraphStyle: paragraph,
            .strikethroughStyle: kind == .completed
                ? NSUnderlineStyle.single.rawValue
                : 0,
        ]

        if textView.text != text
            || coordinator.lastKind != kind {
            let selection = textView.selectedRange
            textView.attributedText = NSAttributedString(
                string: text,
                attributes: attributes
            )
            textView.selectedRange = NSRange(
                location: min(
                    selection.location,
                    text.utf16.count
                ),
                length: 0
            )
        }

        textView.typingAttributes = attributes
        coordinator.lastKind = kind
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: DaySpaceTodoLineEditor
        var lastFocusToken: UUID?
        var lastKind: DaySpaceTodoEntryKind?

        init(
            parent: DaySpaceTodoLineEditor
        ) {
            self.parent = parent
        }

        func textViewDidChange(
            _ textView: UITextView
        ) {
            parent.onTextChange(
                textView.text
            )
            textView.invalidateIntrinsicContentSize()
        }

        func textView(
            _ textView: UITextView,
            shouldChangeTextIn range: NSRange,
            replacementText value: String
        ) -> Bool {
            guard value == "\n",
                  textView.markedTextRange == nil
            else {
                return true
            }

            if let native = textView
                as? DaySpaceTodoNativeTextView,
               native.consumeShiftReturn() {
                return true
            }

            return !parent.onSplit(range)
        }
    }
}

private final class DaySpaceTodoNativeTextView: UITextView {
    var onBackspaceAtStart: (() -> Bool)?
    var onDeleteForwardAtEnd: (() -> Bool)?
    var onMovePrevious: (() -> Bool)?
    var onMoveNext: (() -> Bool)?
    var onPasteMultiline: ((NSRange, String) -> Bool)?

    private var shiftReturnPending = false

    override func deleteBackward() {
        if selectedRange.length == 0,
           selectedRange.location == 0,
           onBackspaceAtStart?() == true {
            return
        }

        super.deleteBackward()
    }

    override func paste(
        _ sender: Any?
    ) {
        if let value = UIPasteboard.general.string,
           (value.contains("\n")
                || value.contains("\r")),
           onPasteMultiline?(
                selectedRange,
                value
           ) == true {
            return
        }

        super.paste(sender)
    }

    override func pressesBegan(
        _ presses: Set<UIPress>,
        with event: UIPressesEvent?
    ) {
        guard let key = presses.first?.key else {
            super.pressesBegan(
                presses,
                with: event
            )
            return
        }

        let textLength = text.utf16.count
        let collapsed = selectedRange.length == 0

        if key.keyCode == .keyboardReturn,
           key.modifierFlags.contains(.shift) {
            shiftReturnPending = true
            super.pressesBegan(
                presses,
                with: event
            )
            return
        }

        if key.keyCode == .keyboardDeleteForward,
           collapsed,
           selectedRange.location == textLength,
           onDeleteForwardAtEnd?() == true {
            return
        }

        if key.keyCode == .keyboardLeftArrow,
           collapsed,
           selectedRange.location == 0,
           onMovePrevious?() == true {
            return
        }

        if key.keyCode == .keyboardRightArrow,
           collapsed,
           selectedRange.location == textLength,
           onMoveNext?() == true {
            return
        }

        if key.keyCode == .keyboardUpArrow,
           collapsed,
           selectedRange.location == 0,
           onMovePrevious?() == true {
            return
        }

        if key.keyCode == .keyboardDownArrow,
           collapsed,
           selectedRange.location == textLength,
           onMoveNext?() == true {
            return
        }

        super.pressesBegan(
            presses,
            with: event
        )
    }

    func consumeShiftReturn() -> Bool {
        defer {
            shiftReturnPending = false
        }

        return shiftReturnPending
    }
}

private struct DaySpaceDiaryPaperDetail: View {
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
                .frame(height: 23)
                .padding(.bottom, 14)
                .disabled(isSaving)
                .onChange(of: title) {
                    _,
                    _ in
                    errorMessage = nil
                }

                DaySpaceDiaryBodyEditor(
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
        .confirmationDialog(
            "放弃未保存的修改？",
            isPresented: $discardConfirmationPresented,
            titleVisibility: .visible
        ) {
            Button(
                "放弃",
                role: .destructive
            ) {
                onClosed()
            }

            Button(
                "继续编辑",
                role: .cancel
            ) {}
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

private struct DaySpaceDiaryBodyEditor: UIViewRepresentable {
    let text: String
    let disabled: Bool
    let onTextChange: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(
        context: Context
    ) -> UITextView {
        let textView = UITextView()
        textView.backgroundColor = .clear
        textView.isScrollEnabled = false
        textView.textContainerInset = .zero
        textView.textContainer.lineFragmentPadding = 0
        textView.delegate = context.coordinator
        textView.autocorrectionType = .default
        textView.spellCheckingType = .default
        configureTypingAppearance(
            for: textView
        )
        return textView
    }

    func updateUIView(
        _ textView: UITextView,
        context: Context
    ) {
        context.coordinator.parent = self
        textView.isEditable = !disabled
        configureTypingAppearance(
            for: textView
        )

        guard textView.text != text,
              textView.markedTextRange == nil
        else {
            return
        }

        let selection = textView.selectedRange
        textView.attributedText = attributedText(
            text
        )
        textView.selectedRange = NSRange(
            location: min(
                selection.location,
                text.utf16.count
            ),
            length: 0
        )
    }

    func sizeThatFits(
        _ proposal: ProposedViewSize,
        uiView: UITextView,
        context: Context
    ) -> CGSize? {
        guard let width = proposal.width else {
            return nil
        }

        let fitting = uiView.sizeThatFits(
            CGSize(
                width: width,
                height: .greatestFiniteMagnitude
            )
        )

        return CGSize(
            width: width,
            height: max(
                420,
                ceil(fitting.height)
            )
        )
    }

    private func configureTypingAppearance(
        for textView: UITextView
    ) {
        textView.typingAttributes = textAttributes
    }

    private var textAttributes: [
        NSAttributedString.Key: Any
    ] {
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = 30
        paragraph.maximumLineHeight = 30

        return [
            .font: UIFont.systemFont(
                ofSize: 14
            ),
            .foregroundColor: UIColor(
                white: 0.15,
                alpha: 1
            ),
            .paragraphStyle: paragraph,
        ]
    }

    private func attributedText(
        _ value: String
    ) -> NSAttributedString {
        NSAttributedString(
            string: value,
            attributes: textAttributes
        )
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: DaySpaceDiaryBodyEditor

        init(
            parent: DaySpaceDiaryBodyEditor
        ) {
            self.parent = parent
        }

        func textViewDidChange(
            _ textView: UITextView
        ) {
            parent.onTextChange(
                textView.text
            )
            textView.invalidateIntrinsicContentSize()
        }
    }
}

private struct DaySpacePaperDetailLayer<
    Content: View,
    TopRight: View,
    Signature: View
>: View {
    let dateLabel: String
    let errorMessage: String?
    let onRequestClose: () -> Void
    let topRight: TopRight
    let signature: Signature
    let content: Content

    init(
        dateLabel: String,
        errorMessage: String?,
        onRequestClose: @escaping () -> Void,
        @ViewBuilder topRight: () -> TopRight,
        @ViewBuilder signature: () -> Signature,
        @ViewBuilder content: () -> Content
    ) {
        self.dateLabel = dateLabel
        self.errorMessage = errorMessage
        self.onRequestClose = onRequestClose
        self.topRight = topRight()
        self.signature = signature()
        self.content = content()
    }

    var body: some View {
        GeometryReader { proxy in
            let dimensions = paperDimensions(
                for: proxy.size
            )

            ZStack {
                Color.white
                    .opacity(0.82)
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture {
                        onRequestClose()
                    }

                ZStack(
                    alignment: .topLeading
                ) {
                    RoundedRectangle(
                        cornerRadius: 14
                    )
                    .fill(Color.white)

                    ScrollView {
                        content
                            .frame(
                                maxWidth: .infinity,
                                minHeight: max(
                                    0,
                                    dimensions.height - 80
                                ),
                                alignment: .topLeading
                            )
                            .background {
                                DaySpacePaperRules()
                            }
                    }
                    .scrollIndicators(.hidden)
                    .padding(.horizontal, 24)
                    .padding(.top, 42)
                    .padding(.bottom, 38)

                    Text(dateLabel)
                        .font(
                            .system(
                                size: 13
                            )
                        )
                        .tracking(0.52)
                        .foregroundStyle(
                            Color(
                                white: 0.43
                            )
                        )
                        .padding(
                            .leading,
                            24
                        )
                        .padding(
                            .top,
                            13
                        )

                    topRight
                        .padding(
                            .trailing,
                            24
                        )
                        .padding(
                            .top,
                            13
                        )
                        .frame(
                            maxWidth: .infinity,
                            alignment: .topTrailing
                        )

                    signature
                        .padding(
                            .trailing,
                            24
                        )
                        .padding(
                            .bottom,
                            11
                        )
                        .frame(
                            maxWidth: .infinity,
                            maxHeight: .infinity,
                            alignment: .bottomTrailing
                        )

                    if let errorMessage {
                        Text(errorMessage)
                            .font(
                                .system(
                                    size: 12
                                )
                            )
                            .foregroundStyle(
                                Color.red
                            )
                            .lineLimit(2)
                            .padding(
                                .leading,
                                24
                            )
                            .padding(
                                .trailing,
                                68
                            )
                            .padding(
                                .bottom,
                                9
                            )
                            .frame(
                                maxWidth: .infinity,
                                maxHeight: .infinity,
                                alignment: .bottomLeading
                            )
                    }
                }
                .foregroundStyle(
                    Color(
                        white: 0.09
                    )
                )
                .frame(
                    width: dimensions.width,
                    height: dimensions.height
                )
                .clipShape(
                    RoundedRectangle(
                        cornerRadius: 14
                    )
                )
                .overlay(
                    RoundedRectangle(
                        cornerRadius: 14
                    )
                    .stroke(
                        Color.black.opacity(0.11),
                        lineWidth: 1
                    )
                )
                .shadow(
                    color: .black.opacity(0.09),
                    radius: 28,
                    y: 18
                )
                .offset(
                    y: dimensions.offsetY
                )
            }
            .frame(
                maxWidth: .infinity,
                maxHeight: .infinity
            )
        }
        .background(
            Color.clear
                .ignoresSafeArea()
        )
        .onExitCommand {
            onRequestClose()
        }
    }

    private func paperDimensions(
        for size: CGSize
    ) -> (
        width: CGFloat,
        height: CGFloat,
        offsetY: CGFloat
    ) {
        let width = min(
            665,
            max(
                280,
                size.width - 46
            )
        )

        if size.height < 680 {
            return (
                width,
                max(
                    360,
                    size.height - 20
                ),
                min(
                    31,
                    max(
                        0,
                        size.height * 0.04
                    )
                )
            )
        }

        let height = min(
            696,
            max(
                536,
                size.height * 0.78 - 24
            )
        )

        return (
            width,
            min(
                size.height - 20,
                height
            ),
            31
        )
    }
}

private struct DaySpacePaperRules: View {
    var body: some View {
        GeometryReader { proxy in
            Path { path in
                var y: CGFloat = 29.5

                while y < proxy.size.height {
                    path.move(
                        to: CGPoint(
                            x: 0,
                            y: y
                        )
                    )
                    path.addLine(
                        to: CGPoint(
                            x: proxy.size.width,
                            y: y
                        )
                    )
                    y += 30
                }
            }
            .stroke(
                Color.black.opacity(0.075),
                lineWidth: 1
            )
        }
        .allowsHitTesting(false)
    }
}

private enum DaySpaceDiscoveryState: Equatable {
    case loading
    case ready
    case unavailable
}

private enum DaySpaceModuleState<Value> {
    case loading(Value?)
    case ready(Value)
    case error(Value?)

    var value: Value? {
        switch self {
        case .loading(let value), .error(let value):
            return value
        case .ready(let value):
            return value
        }
    }

    var isLoading: Bool {
        if case .loading = self {
            return true
        }
        return false
    }

    var isError: Bool {
        if case .error = self {
            return true
        }
        return false
    }

    var isErrorWithoutValue: Bool {
        if case .error(nil) = self {
            return true
        }
        return false
    }
}

private enum DaySpacePaperSelection: Identifiable {
    case todo(DaySpaceTodoPaper)
    case diary(DaySpaceDiary)

    var id: String {
        switch self {
        case .todo(let paper):
            return "todo:\(paper.date):\(paper.author.rawValue)"
        case .diary(let diary):
            return "diary:\(diary.id)"
        }
    }

    var density: Int {
        switch self {
        case .todo(let paper):
            return max(1, paper.entries.count)

        case .diary(let diary):
            let length = diary.title.utf16.count
                + diary.content.utf16.count
            return max(
                2,
                min(
                    6,
                    Int(ceil(Double(length) / 44.0))
                )
            )
        }
    }

    var authorLabel: String {
        switch self {
        case .todo(let paper):
            return paper.author.rawValue
        case .diary(let diary):
            return diary.author?.rawValue ?? "—"
        }
    }
}

private enum DaySpaceAuthor: String, Codable, CaseIterable, Identifiable {
    case L
    case G
    case C

    var id: String { rawValue }
}

private enum DaySpaceTodoEntryKind: String, Codable {
    case pending
    case completed
    case record

    var next: DaySpaceTodoEntryKind {
        switch self {
        case .pending:
            return .completed
        case .completed:
            return .record
        case .record:
            return .pending
        }
    }
}

private struct DaySpaceTodoEntry: Codable, Identifiable {
    let id: String
    let kind: DaySpaceTodoEntryKind
    let text: String
}

private struct DaySpaceTodoPaper: Codable, Identifiable {
    let author: DaySpaceAuthor
    let date: String
    let revision: Int
    let entries: [DaySpaceTodoEntry]

    var id: String {
        "\(date):\(author.rawValue)"
    }
}

private struct DaySpaceTodoPapers: Codable {
    var L: DaySpaceTodoPaper?
    var G: DaySpaceTodoPaper?
    var C: DaySpaceTodoPaper?

    subscript(author: DaySpaceAuthor) -> DaySpaceTodoPaper? {
        get {
            switch author {
            case .L: return L
            case .G: return G
            case .C: return C
            }
        }
        set {
            switch author {
            case .L: L = newValue
            case .G: G = newValue
            case .C: C = newValue
            }
        }
    }
}

private struct DaySpaceTodoDay: Codable {
    let date: String
    var papers: DaySpaceTodoPapers

    var visiblePapers: [DaySpaceTodoPaper] {
        DaySpaceAuthor.allCases.compactMap { author in
            guard let paper = papers[author],
                  !paper.entries.isEmpty
            else {
                return nil
            }
            return paper
        }
    }

    mutating func setPaper(
        _ paper: DaySpaceTodoPaper?,
        for author: DaySpaceAuthor
    ) {
        papers[author] = paper
    }
}

private struct DaySpaceDiary: Codable, Identifiable {
    let id: String
    let title: String
    let content: String
    let date: String
    let author: DaySpaceAuthor?
    let tags: [String]
    let mood: String?
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case content
        case date
        case author
        case tags
        case mood
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

private struct DaySpaceDatesEnvelope: Decodable {
    let success: Bool
    let data: DaySpaceDatesData
}

private struct DaySpaceDatesData: Decodable {
    let dates: [String]
}

private struct DaySpaceTodoDayEnvelope: Decodable {
    let success: Bool
    let data: DaySpaceTodoDay
}

private struct DaySpaceTodoPaperEnvelope: Decodable {
    let success: Bool
    let data: DaySpaceTodoPaper
}

private struct DaySpaceDiaryDayEnvelope: Decodable {
    let success: Bool
    let data: DaySpaceDiaryDay
}

private struct DaySpaceDiaryDay: Decodable {
    let date: String
    let diaries: [DaySpaceDiary]
}

private struct DaySpaceDiaryEnvelope: Decodable {
    let success: Bool
    let data: DaySpaceDiary
}

private struct DaySpaceDiaryUpdateRequest: Encodable {
    let title: String
    let content: String
    let date: String
    let tags: [String]
    let mood: String?
    let author: DaySpaceAuthor
}

private struct DaySpaceTodoReplaceRequest: Encodable {
    let revision: Int?
    let entries: [DaySpaceTodoEntry]

    enum CodingKeys: String, CodingKey {
        case revision
        case entries
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(
            keyedBy: CodingKeys.self
        )

        if let revision {
            try container.encode(
                revision,
                forKey: .revision
            )
        } else {
            try container.encodeNil(
                forKey: .revision
            )
        }

        try container.encode(
            entries,
            forKey: .entries
        )
    }
}

private struct DaySpaceEditableTodoEntry: Identifiable {
    let id: String
    var kind: DaySpaceTodoEntryKind
    var text: String
    var creation: Bool

    static func initialRows(
        author: DaySpaceAuthor,
        entries: [DaySpaceTodoEntry]
    ) -> [DaySpaceEditableTodoEntry] {
        var rows = entries.map {
            DaySpaceEditableTodoEntry(
                id: $0.id,
                kind: $0.kind,
                text: $0.text,
                creation: false
            )
        }

        let lastContentIndex = rows.lastIndex {
            !$0.text.trimmingCharacters(
                in: .whitespacesAndNewlines
            ).isEmpty
        }

        let targetCount = max(
            24,
            (lastContentIndex ?? -1) + 2
        )

        while rows.count < targetCount {
            rows.append(
                creationRow()
            )
        }

        return rows
    }

    static func creationRow() -> DaySpaceEditableTodoEntry {
        DaySpaceEditableTodoEntry(
            id: UUID().uuidString.lowercased(),
            kind: .pending,
            text: "",
            creation: true
        )
    }
}

private enum DaySpacePaperSize {
    case small
    case medium
    case large
}

private struct DaySpaceLayoutItem {
    let id: String
    let left: CGFloat
    let top: CGFloat
    let width: CGFloat
    let height: CGFloat
    let rotation: Double
    let zIndex: Int
    let size: DaySpacePaperSize
}

private struct DaySpaceLayout {
    let items: [DaySpaceLayoutItem]
    let stageHeight: CGFloat

    var itemsByID: [String: DaySpaceLayoutItem] {
        Dictionary(
            uniqueKeysWithValues: items.map {
                ($0.id, $0)
            }
        )
    }

    static func layout(
        dateKey: String,
        papers: [DaySpacePaperSelection],
        rawStageWidth: CGFloat
    ) -> DaySpaceLayout {
        let stageWidth = max(280, rawStageWidth)
        let ordered = papers.sorted {
            DaySpaceHash.hash("\(dateKey):\($0.id):order")
                < DaySpaceHash.hash("\(dateKey):\($1.id):order")
        }

        var placed: [DaySpaceLayoutItem] = []
        let laneRatios: [CGFloat] = [0, 0.5, 1]

        for (index, paper) in ordered.enumerated() {
            let seed = "\(dateKey):\(paper.id)"
            let density = max(1, paper.density)
            let size = chooseSize(
                seed: seed,
                density: density
            )
            let dimensions = dimensions(
                size: size,
                stageWidth: stageWidth
            )
            let width = dimensions.width
            let height = dimensions.height
            let maxLeft = max(0, stageWidth - width)

            var lane = Int(
                DaySpaceHash.hash("\(seed):lane")
                    % UInt32(laneRatios.count)
            )

            if index > 0 {
                let previous = placed[index - 1]
                let previousCenter = previous.left
                    + previous.width / 2
                let candidateCenter = maxLeft
                    * laneRatios[lane]
                    + width / 2

                if abs(previousCenter - candidateCenter) < 62 {
                    lane = (
                        lane
                        + 1
                        + Int(
                            DaySpaceHash.hash(
                                "\(seed):lane-shift"
                            ) % 2
                        )
                    ) % 3
                }
            }

            let horizontalJitter = CGFloat(
                DaySpaceHash.seededUnit("\(seed):x") - 0.5
            ) * min(26, maxLeft * 0.14)

            var left = clamp(
                maxLeft * laneRatios[lane]
                    + horizontalJitter,
                min: 0,
                max: maxLeft
            )

            let bandStep = 103
                + DaySpaceHash.seededUnit(
                    "\(dateKey):\(index):band-step"
                ) * 31

            var top = 10
                + Double(index) * bandStep
                + (
                    DaySpaceHash.seededUnit(
                        "\(seed):y"
                    ) - 0.5
                ) * 34

            let rotation = -3.4
                + DaySpaceHash.seededUnit(
                    "\(seed):rotation"
                ) * 6.8

            for attempt in 0..<12 {
                let candidate = DaySpaceLayoutCandidate(
                    left: left,
                    top: CGFloat(top),
                    width: width,
                    height: height
                )

                let worst = placed.reduce(
                    CGFloat.zero
                ) { value, existing in
                    max(
                        value,
                        overlapFraction(
                            existing,
                            candidate
                        )
                    )
                }

                if worst <= 0.15 {
                    break
                }

                let alternateLane = (
                    lane + 1 + attempt
                ) % 3

                left = clamp(
                    maxLeft * laneRatios[alternateLane]
                        + CGFloat(
                            DaySpaceHash.seededUnit(
                                "\(seed):retry-x:\(attempt)"
                            ) - 0.5
                        ) * 20,
                    min: 0,
                    max: maxLeft
                )

                top += 16 + Double(attempt) * 4
            }

            placed.append(
                DaySpaceLayoutItem(
                    id: paper.id,
                    left: left,
                    top: max(0, CGFloat(top)),
                    width: width,
                    height: height,
                    rotation: rotation,
                    zIndex: 2 + Int(
                        DaySpaceHash.hash(
                            "\(seed):z"
                        ) % 7
                    ),
                    size: size
                )
            )
        }

        let finalBottom = placed.reduce(
            CGFloat.zero
        ) {
            max(
                $0,
                $1.top + $1.height
            )
        }

        return DaySpaceLayout(
            items: placed,
            stageHeight: max(
                260,
                finalBottom + 52
            )
        )
    }

    private static func chooseSize(
        seed: String,
        density: Int
    ) -> DaySpacePaperSize {
        if density >= 5 {
            return .large
        }

        if density <= 1 {
            return DaySpaceHash.seededUnit(
                "\(seed):size"
            ) < 0.74
                ? .small
                : .medium
        }

        if density >= 4 {
            return DaySpaceHash.seededUnit(
                "\(seed):size"
            ) < 0.64
                ? .large
                : .medium
        }

        return DaySpaceHash.seededUnit(
            "\(seed):size"
        ) < 0.58
            ? .medium
            : .large
    }

    private static func dimensions(
        size: DaySpacePaperSize,
        stageWidth: CGFloat
    ) -> (width: CGFloat, height: CGFloat) {
        switch size {
        case .small:
            return (
                min(158, stageWidth * 0.46),
                112
            )

        case .medium:
            return (
                min(186, stageWidth * 0.55),
                134
            )

        case .large:
            return (
                min(218, stageWidth * 0.64),
                158
            )
        }
    }

    private static func overlapFraction(
        _ left: DaySpaceLayoutItem,
        _ right: DaySpaceLayoutCandidate
    ) -> CGFloat {
        let width = max(
            0,
            min(
                left.left + left.width,
                right.left + right.width
            ) - max(left.left, right.left)
        )

        let height = max(
            0,
            min(
                left.top + left.height,
                right.top + right.height
            ) - max(left.top, right.top)
        )

        guard width > 0,
              height > 0
        else {
            return 0
        }

        let overlapArea = width * height
        let smallerArea = min(
            left.width * left.height,
            right.width * right.height
        )

        return overlapArea / smallerArea
    }

    private static func clamp(
        _ value: CGFloat,
        min minimum: CGFloat,
        max maximum: CGFloat
    ) -> CGFloat {
        Swift.max(
            minimum,
            Swift.min(
                maximum,
                value
            )
        )
    }
}

private struct DaySpaceLayoutCandidate {
    let left: CGFloat
    let top: CGFloat
    let width: CGFloat
    let height: CGFloat
}

private enum DaySpaceHash {
    static func hash(_ value: String) -> UInt32 {
        var hash: UInt32 = 2_166_136_261

        for codeUnit in value.utf16 {
            hash ^= UInt32(codeUnit)
            hash = hash &* 16_777_619
        }

        return hash
    }

    static func seededUnit(_ seed: String) -> Double {
        Double(hash(seed) % 100_000)
            / 100_000
    }
}

private enum DaySpaceDate {
    static func businessDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    static func isValid(_ value: String) -> Bool {
        date(value) != nil
    }

    static func date(_ value: String) -> Date? {
        let components = value.split(
            separator: "-",
            omittingEmptySubsequences: false
        )

        guard components.count == 3,
              let year = Int(components[0]),
              let month = Int(components[1]),
              let day = Int(components[2]),
              (1...12).contains(month),
              (1...31).contains(day)
        else {
            return nil
        }

        var calendar = Calendar(
            identifier: .gregorian
        )
        calendar.timeZone = .current

        guard let date = calendar.date(
            from: DateComponents(
                year: year,
                month: month,
                day: day
            )
        ) else {
            return nil
        }

        let resolved = calendar.dateComponents(
            [.year, .month, .day],
            from: date
        )

        guard resolved.year == year,
              resolved.month == month,
              resolved.day == day
        else {
            return nil
        }

        return date
    }

    static func shift(
        _ value: String,
        by amount: Int
    ) -> String {
        guard let date = date(value),
              let shifted = Calendar.current.date(
                byAdding: .day,
                value: amount,
                to: date
              )
        else {
            return value
        }

        return businessDate(shifted)
    }

    static func rowLabel(_ value: String) -> String {
        let components = value.split(
            separator: "-",
            omittingEmptySubsequences: false
        )
        guard components.count == 3,
              let month = Int(components[1]),
              let day = Int(components[2])
        else {
            return value
        }

        return "\(month)/\(day)"
    }

    static func paperLabel(_ value: String) -> String {
        value.replacingOccurrences(
            of: "-",
            with: "."
        )
    }

    static func fullLabel(_ value: String) -> String {
        guard let date = date(value) else {
            return value
        }

        return date.formatted(
            .dateTime
                .month(.wide)
                .day()
                .year()
        )
    }

    static func toolbarLabel(_ value: String) -> String {
        guard let date = date(value) else {
            return value
        }

        return date.formatted(
            .dateTime
                .month(.abbreviated)
                .day()
        )
    }
}
