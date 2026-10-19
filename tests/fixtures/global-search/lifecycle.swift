// Synthetic service only. Task ownership and result merging below are inserted
// unchanged from the production GlobalSearchView declarations by the Node test.
@MainActor final class ControlledSearch: GlobalSearchService {
    struct Call {
        let request: GlobalSearchRequest
        let cursor: String?
        let reply: CheckedContinuation<GlobalSearchResponse, Error>
    }
    var calls: [Call] = []
    func search(_ request: GlobalSearchRequest, cursor: String?) async throws -> GlobalSearchResponse {
        try await withCheckedThrowingContinuation { calls.append(Call(request: request, cursor: cursor, reply: $0)) }
    }
    func waitForCalls(_ count: Int) async {
        while calls.count < count { await Task.yield() }
    }
}
@MainActor final class SearchHarness {
    enum State { case idle, loading, results(GlobalSearchResponse), noResults, queryTooLong, unavailable }
    let service = ControlledSearch()
    var query = ""
    // Request construction/UI bindings are outside this task-lifecycle boundary.
    var currentRequest: GlobalSearchRequest?
    var state = State.idle
    var searchTask: Task<Void, Never>?
    var loadMoreTask: Task<Void, Never>?
    var isLoadingMore = false
    var loadMoreFailed = false
    // PRODUCTION_METHODS
    func start(_ value: String) {
        query = value
        currentRequest = value.isEmpty ? nil : GlobalSearchRequest(query: value, modules: [.mind, .diary], scope: .active, mode: .normal, author: .all, dateFrom: nil, dateTo: nil)
        scheduleSearch()
    }
    func more(_ response: GlobalSearchResponse) { loadMore(response) }
    var rows: [String] {
        guard case .results(let response) = state else { return [] }
        return response.results.map(\.id)
    }
    var response: GlobalSearchResponse {
        guard case .results(let response) = state else { preconditionFailure("expected results") }
        return response
    }
}
func item(_ id: String, _ module: GlobalSearchModule = .mind) -> GlobalSearchResultItem {
    GlobalSearchResultItem(entityType: module, entityID: id, stableName: "", snippet: id, matchedField: "text", matchReason: "field_match", lifecycleStatus: "active", businessTime: nil, timeBasis: "undated", updatedAt: "2026-10-19T00:00:00Z", author: nil, detailTool: "get_memory", detailArguments: ["id": id])
}
func page(_ items: [GlobalSearchResultItem], _ cursor: String? = nil) -> GlobalSearchResponse {
    GlobalSearchResponse(results: items, count: items.count, hasMore: cursor != nil, nextCursor: cursor, searchedModules: [.mind, .diary], searchedScope: .active, searchedAuthor: nil)
}
Task { @MainActor in
    for lateFailure in [false, true] {
        let h = SearchHarness()
        h.start("old"); let old = h.searchTask!
        await h.service.waitForCalls(1)
        h.start("current"); let current = h.searchTask!
        await h.service.waitForCalls(2)
        h.service.calls[1].reply.resume(returning: page([item("current")]))
        await current.value
        if lateFailure { h.service.calls[0].reply.resume(throwing: GlobalSearchServiceError.unavailable) }
        else { h.service.calls[0].reply.resume(returning: page([item("obsolete")])) }
        await old.value
        precondition(h.rows == ["mind:current"], "late search response replaced the current query")
    }
    print("PASS stale-search success/failure")

    let h = SearchHarness()
    h.state = .results(page([item("same")], "page-2"))
    h.query = "notes"
    h.currentRequest = GlobalSearchRequest(query: "notes", modules: [.mind, .diary], scope: .active, mode: .normal, author: .all, dateFrom: nil, dateTo: nil)
    h.more(h.response); let failed = h.loadMoreTask!
    await h.service.waitForCalls(1)
    h.more(h.response)
    await Task.yield()
    precondition(h.service.calls.count == 1, "parallel pagination must be single-flight")
    h.service.calls[0].reply.resume(throwing: GlobalSearchServiceError.unavailable)
    await failed.value
    precondition(h.rows == ["mind:same"] && !h.isLoadingMore && h.loadMoreFailed)
    precondition(h.response.nextCursor == "page-2")
    h.more(h.response); let retry = h.loadMoreTask!
    await h.service.waitForCalls(2)
    precondition(h.service.calls[1].cursor == h.service.calls[0].cursor && h.service.calls[1].request == h.service.calls[0].request)
    h.service.calls[1].reply.resume(returning: page([item("same"), item("same", .diary), item("new")]))
    await retry.value
    precondition(h.rows == ["mind:same", "diary:same", "mind:new"])
    precondition(!h.isLoadingMore && !h.loadMoreFailed && h.response.nextCursor == nil)
    print("PASS pagination retry/identity/single-flight")

    let changing = SearchHarness()
    changing.state = .results(page([item("old")], "page-2"))
    changing.currentRequest = h.currentRequest
    changing.more(changing.response); let obsoletePage = changing.loadMoreTask!
    await changing.service.waitForCalls(1)
    changing.start("replacement"); let replacement = changing.searchTask!
    await changing.service.waitForCalls(2)
    changing.service.calls[1].reply.resume(returning: page([item("replacement")]))
    await replacement.value
    changing.service.calls[0].reply.resume(returning: page([item("obsolete-page")], "page-3"))
    await obsoletePage.value
    precondition(changing.rows == ["mind:replacement"] && !changing.isLoadingMore && !changing.loadMoreFailed)
    print("PASS cancelled-pagination")

    let failure = SearchHarness()
    failure.start("notes"); let failedSearch = failure.searchTask!
    await failure.service.waitForCalls(1)
    failure.service.calls[0].reply.resume(throwing: GlobalSearchServiceError.unavailable)
    await failedSearch.value
    guard case .unavailable = failure.state else { preconditionFailure("failed search must be retryable") }
    failure.start("")
    guard case .idle = failure.state else { preconditionFailure("empty query must be idle") }
    failure.start(String(repeating: "a", count: 201))
    guard case .queryTooLong = failure.state else { preconditionFailure("oversized query must be rejected before network") }
    precondition(failure.service.calls.count == 1)
    print("PASS failure/empty/query-limit")
    exit(0)
}
dispatchMain()
