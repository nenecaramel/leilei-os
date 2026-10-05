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
