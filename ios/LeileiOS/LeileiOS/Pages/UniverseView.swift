import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct UniverseView: View {
    @EnvironmentObject private var appModel: AppModel

    let targetNodeID: String?
    let onTargetConsumed: () -> Void

    @State private var state: UniversePageState = .loading
    @State private var selectedNodeID: String?
    @State private var activeGalaxyID: String?
    @State private var mapMode: UniverseMapMode = .browse
    @State private var sheetSelection: UniverseSheetSelection?
    @State private var notice: String?
    @State private var loadGeneration = 0

    @State private var importPresented = false
    @State private var importPreview: UniverseImportPreview?
    @State private var importFileName: String?
    @State private var importError: String?
    @State private var importUncertain = false
    @State private var importCommitting = false

    @State private var exportPresented = false
    @State private var exportDocument: UniverseJSONDocument?
    @State private var exportFilename = "蕾蕾宇宙备份"

    init(
        targetNodeID: String? = nil,
        onTargetConsumed: @escaping () -> Void = {}
    ) {
        self.targetNodeID = targetNodeID
        self.onTargetConsumed = onTargetConsumed
    }

    var body: some View {
        Group {
            switch state {
            case .loading:
                universeLoading

            case .notInitialized:
                universeImport

            case .failed:
                universeFailure

            case .ready(let result):
                universeReady(result)
            }
        }
        .frame(
            maxWidth: .infinity,
            maxHeight: .infinity
        )
        .background(
            UniversePalette.background
                .ignoresSafeArea()
        )
        .environment(\.colorScheme, .dark)
        .toolbar {
            if case .ready(let result) = state {
                readyToolbar(result)
            }
        }
        .fullScreenCover(
            item: $sheetSelection
        ) { selection in
            nodeSheet(selection)
                .presentationBackground(
                    UniversePalette.background
                )
        }
        .fileImporter(
            isPresented: $importPresented,
            allowedContentTypes: [.json],
            allowsMultipleSelection: false
        ) { result in
            handleImportedFile(result)
        }
        .fileExporter(
            isPresented: $exportPresented,
            document: exportDocument,
            contentType: .json,
            defaultFilename: exportFilename
        ) { result in
            if case .failure = result {
                showNotice("导出未完成")
            }
            exportDocument = nil
        }
        .task {
            await load()
        }
        .task(id: targetNodeID) {
            await openTargetIfPossible()
        }
    }

    private var universeLoading: some View {
        VStack(spacing: 14) {
            ProgressView()
            Text("Reading...")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private var universeFailure: some View {
        AppStateSurface(
            title: "Unable to read Universe",
            actionTitle: "Retry"
        ) {
            Task {
                await load()
            }
        }
        .frame(
            maxWidth: .infinity,
            maxHeight: .infinity
        )
    }

    private var universeImport: some View {
        ScrollView {
            VStack(
                spacing: 18
            ) {
                Spacer(minLength: 100)

                Image(
                    systemName:
                        "sparkles.rectangle.stack"
                )
                .font(
                    .system(
                        size: 38,
                        weight: .light
                    )
                )
                .foregroundStyle(.secondary)

                Text("Universe 还没有内容")
                    .font(.title3.weight(.medium))

                if let importFileName {
                    Text(importFileName)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                if let importPreview {
                    VStack(spacing: 6) {
                        Text(
                            "\(importPreview.galaxies) 星系 · "
                                + "\(importPreview.nodes) 星球 · "
                                + "\(importPreview.relations) 连接 · "
                                + "\(importPreview.revisions) 历史版本"
                        )

                        Text(
                            importPreview.conversions
                                .joined(separator: " · ")
                        )
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                }

                if let importError {
                    Text(importError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }

                if importCommitting {
                    ProgressView("正在迁移…")
                }

                VStack(spacing: 10) {
                    if importUncertain {
                        Button("重新读取") {
                            Task {
                                await recheckImport()
                            }
                        }
                        .buttonStyle(.borderedProminent)
                    } else {
                        if importFileName == nil {
                            Button(
                                "选择旧 Universe JSON"
                            ) {
                                importPresented = true
                            }
                            .buttonStyle(.borderedProminent)
                        }

                        if importPreview != nil {
                            Button("确认迁移") {
                                Task {
                                    await confirmImport()
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(importCommitting)
                        }

                        if importFileName != nil {
                            Button("重新选择") {
                                importPresented = true
                            }
                            .buttonStyle(.bordered)
                            .disabled(importCommitting)
                        }
                    }
                }
            }
            .padding(.horizontal, 24)
            .frame(
                maxWidth: 620
            )
            .frame(maxWidth: .infinity)
        }
    }

    private func universeReady(
        _ result: UniverseReadResult
    ) -> some View {
        ZStack(alignment: .top) {
            UniverseMapView(
                nodes: result.snapshot.nodes,
                galaxies: result.snapshot.galaxies,
                relations: result.snapshot.relations,
                selectedNodeID: selectedNodeID,
                activeGalaxyID: activeGalaxyID,
                mode: mapMode,
                onSelectNode: { nodeID in
                    selectedNodeID = nodeID
                },
                onOpenNode: { nodeID in
                    selectedNodeID = nodeID
                    sheetSelection = .node(nodeID)
                },
                onPlaceNode: { position in
                    selectedNodeID = nil
                    sheetSelection = .create(position)
                },
                onMoveNode: {
                    nodeID,
                    position in
                    await moveNode(
                        nodeID,
                        to: position
                    )
                },
                onModeChange: {
                    mapMode = $0
                }
            )

            if let notice {
                Text(notice)
                    .font(.subheadline)
                    .foregroundStyle(
                        Color.white.opacity(0.82)
                    )
                    .padding(
                        .horizontal,
                        13
                    )
                    .padding(
                        .vertical,
                        8
                    )
                    .background(
                        .thinMaterial,
                        in: Capsule()
                    )
                    .padding(.top, 8)
                    .transition(
                        .opacity.combined(
                            with: .move(
                                edge: .top
                            )
                        )
                    )
            }
        }
    }

    @ToolbarContentBuilder
    private func readyToolbar(
        _ result: UniverseReadResult
    ) -> some ToolbarContent {
        ToolbarItemGroup(
            placement: .topBarTrailing
        ) {
            Menu {
                Picker(
                    "",
                    selection: $activeGalaxyID
                ) {
                    Text("全部星系")
                        .tag(String?.none)

                    ForEach(
                        result.snapshot.galaxies
                            .sorted {
                                $0.order < $1.order
                            }
                    ) { galaxy in
                        Label {
                            Text(galaxy.title)
                        } icon: {
                            Image(
                                systemName:
                                    "circle.fill"
                            )
                            .foregroundStyle(
                                UniversePalette.color(
                                    hex: galaxy.color
                                )
                            )
                        }
                        .tag(
                            Optional(
                                galaxy.id
                            )
                        )
                    }
                }
                .labelsHidden()
                .pickerStyle(.inline)
            } label: {
                Image(systemName: "circle.grid.2x2")
            }
            .accessibilityLabel("选择星系")

            Button {
                if case .placingNode = mapMode {
                    mapMode = .browse
                } else {
                    selectedNodeID = nil
                    mapMode = .placingNode
                }
            } label: {
                Image(
                    systemName:
                        mapMode == .placingNode
                            ? "xmark"
                            : "plus"
                )
            }
            .accessibilityLabel(
                mapMode == .placingNode
                    ? "取消新增星球"
                    : "新增星球"
            )

            Menu {
                Button {
                    prepareExport(
                        result.snapshot
                    )
                } label: {
                    Label(
                        "导出 Universe",
                        systemImage:
                            "square.and.arrow.up"
                    )
                }
            } label: {
                Image(systemName: "ellipsis")
            }
            .accessibilityLabel(
                "更多 Universe 操作"
            )
        }
    }

    @ViewBuilder
    private func nodeSheet(
        _ selection: UniverseSheetSelection
    ) -> some View {
        if case .ready(let result) = state {
            let selectedNode: UniverseNode?
            let mode: UniverseNodeSheet.Mode

            switch selection {
            case .node(let id):
                selectedNode =
                    result.snapshot.nodes.first {
                        $0.id == id
                    }
                mode = .detail

            case .create(let position):
                selectedNode = nil
                mode = .create(position)
            }

            let nodeID = selectedNode?.id
            let nodeConnections =
                nodeID.map {
                    connections(
                        for: $0,
                        in: result
                    )
                } ?? []
            let nodeSources =
                nodeID.map {
                    sources(
                        for: $0,
                        in: result
                    )
                } ?? []
            let revisionsAvailable =
                nodeID.map { id in
                    result.snapshot.revisions
                        .contains {
                            $0.nodeId == id
                        }
                } ?? false

            UniverseNodeSheet(
                mode: mode,
                node: selectedNode,
                galaxies: result.snapshot.galaxies,
                allNodes: result.snapshot.nodes,
                connections: nodeConnections,
                sources: nodeSources,
                revisionsAvailable: revisionsAvailable,
                onSearchDiarySources: {
                    query in
                    try await UniverseAPIService(
                        api: appModel.api
                    )
                    .searchDiarySources(
                        query: query
                    )
                },
                onSave: {
                    draft,
                    position in
                    try await saveNode(
                        existing: selectedNode,
                        draft: draft,
                        position: position
                    )
                },
                onDelete: {
                    node in
                    try await deleteNode(node)
                },
                onRestore: {
                    node in
                    try await restoreNode(node)
                },
                onCreateRelation: {
                    relation in
                    try await createRelation(
                        relation
                    )
                },
                onDeleteRelation: {
                    relation in
                    try await deleteRelation(
                        relation
                    )
                },
                onOpenRelatedNode: {
                    nodeID in
                    openRelatedNode(nodeID)
                },
                onDiarySourceChanged: {
                    await refreshReadyState()
                },
                onClose: {
                    sheetSelection = nil
                }
            )
        } else {
            ProgressView()
                .frame(
                    maxWidth: .infinity,
                    maxHeight: .infinity
                )
                .background(
                    UniversePalette.background
                )
        }
    }

    private func load() async {
        loadGeneration += 1
        let generation = loadGeneration
        state = .loading

        do {
            let result =
                try await UniverseAPIService(
                    api: appModel.api
                )
                .load()

            guard generation == loadGeneration else {
                return
            }

            state = .ready(result)
            await openTargetIfPossible()
        } catch {
            guard generation == loadGeneration else {
                return
            }

            if UniverseAPIService
                .isNotInitialized(error) {
                state = .notInitialized
            } else {
                state = .failed
            }
        }
    }

    private func recheckImport() async {
        importError = nil
        importUncertain = false
        await load()
    }

    private func handleImportedFile(
        _ result: Result<[URL], Error>
    ) {
        importPreview = nil
        importError = nil
        importUncertain = false

        guard case .success(let urls) = result,
              let url = urls.first
        else {
            if case .failure = result {
                importError =
                    "文件无法用于迁移"
            }
            return
        }

        let didAccess =
            url.startAccessingSecurityScopedResource()
        defer {
            if didAccess {
                url.stopAccessingSecurityScopedResource()
            }
        }

        do {
            let data = try Data(
                contentsOf: url
            )
            let preview =
                try UniverseImportParser.parse(
                    data
                )
            importFileName =
                url.lastPathComponent
            importPreview = preview
        } catch {
            importFileName =
                url.lastPathComponent
            importPreview = nil
            importError =
                "文件无法用于迁移"
        }
    }

    private func confirmImport() async {
        guard let preview = importPreview,
              !importCommitting,
              !importUncertain
        else {
            return
        }

        importCommitting = true
        importError = nil
        defer {
            importCommitting = false
        }

        do {
            let service =
                UniverseAPIService(
                    api: appModel.api
                )
            let fresh =
                try await service.initialize(
                    preview.snapshot
                )
            try UniverseImportParser.verify(
                expected: preview.snapshot,
                actual: fresh.snapshot
            )

            state = .ready(fresh)
            importPreview = nil
            importFileName = nil
            importUncertain = false
            showNotice("Universe 已迁移")
        } catch let error as
            UniverseAPIService.InitializationError {
            switch error {
            case .notWritten:
                importError =
                    "迁移未写入，可以重新确认。"

            case .uncertain:
                importUncertain = true
                importError =
                    "迁移状态暂时无法确认，请先重新读取；不要再次提交。"

            case .alreadyInitialized:
                importUncertain = true
                importError =
                    "服务器已有内容，未覆盖现有内容，请重新读取。"
            }
        } catch {
            importUncertain = true
            importError =
                "迁移状态暂时无法确认，请先重新读取；不要再次提交。"
        }
    }

    private func saveNode(
        existing: UniverseNode?,
        draft: UniverseNodeDraft,
        position: UniversePosition?
    ) async throws {
        guard let memberships =
            draft.canonicalMemberships
        else {
            throw LeileiAPIError.invalidResponse
        }

        let title =
            draft.title.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
        guard !title.isEmpty else {
            throw LeileiAPIError.invalidResponse
        }

        if let existing {
            try await mutate { service, version in
                try await service.updateNode(
                    id: existing.id,
                    patch: UniverseNodePatch(
                        title: title,
                        summary:
                            draft.summary
                                .trimmingCharacters(
                                    in:
                                        .whitespacesAndNewlines
                                ),
                        content:
                            draft.content
                                .trimmingCharacters(
                                    in:
                                        .whitespacesAndNewlines
                                ),
                        type: draft.type,
                        tags: draft.tags,
                        galaxies: memberships,
                        position: nil,
                        importance:
                            draft.importance
                    ),
                    sourceDiaryIDs:
                        draft.sourceDiaryIDs,
                    reason:
                        "Universe iOS 编辑",
                    expectedVersion: version
                )
            }

            selectedNodeID = existing.id
            sheetSelection = .node(existing.id)
            showNotice("星球已更新")
        } else {
            guard let position else {
                throw LeileiAPIError.invalidResponse
            }

            try await mutate { service, version in
                try await service.createNode(
                    UniverseNodeCreateInput(
                        title: title,
                        summary:
                            draft.summary
                                .trimmingCharacters(
                                    in:
                                        .whitespacesAndNewlines
                                ),
                        content:
                            draft.content
                                .trimmingCharacters(
                                    in:
                                        .whitespacesAndNewlines
                                ),
                        type: draft.type,
                        tags: draft.tags,
                        galaxies: memberships,
                        position:
                            position.clamped(),
                        importance:
                            draft.importance
                    ),
                    sourceDiaryIDs:
                        draft.sourceDiaryIDs,
                    expectedVersion: version
                )
            }

            mapMode = .browse
            showNotice(
                "一颗新星已经亮起"
            )
        }
    }

    private func deleteNode(
        _ node: UniverseNode
    ) async throws {
        try await mutate { service, version in
            try await service.deleteNode(
                id: node.id,
                expectedVersion: version
            )
        }

        if selectedNodeID == node.id {
            selectedNodeID = nil
        }
        showNotice(
            "星球已从当前宇宙移除"
        )
    }

    private func restoreNode(
        _ node: UniverseNode
    ) async throws {
        try await mutate { service, version in
            try await service.restoreLatestRevision(
                nodeID: node.id,
                expectedVersion: version
            )
        }

        selectedNodeID = node.id
        sheetSelection = .node(node.id)
        showNotice(
            "已恢复最近的认知版本"
        )
    }

    private func createRelation(
        _ relation: UniverseRelationCreateInput
    ) async throws {
        try await mutate { service, version in
            try await service.createRelation(
                relation,
                expectedVersion: version
            )
        }

        showNotice(
            "新的思想连接已经出现"
        )
    }

    private func deleteRelation(
        _ relation: UniverseRelation
    ) async throws {
        try await mutate { service, version in
            try await service.deleteRelation(
                id: relation.id,
                expectedVersion: version
            )
        }

        showNotice(
            "思想连接已移除"
        )
    }

    private func moveNode(
        _ nodeID: String,
        to position: UniversePosition
    ) async {
        do {
            try await mutate {
                service,
                version in
                try await service.updateNode(
                    id: nodeID,
                    patch: UniverseNodePatch(
                        title: nil,
                        summary: nil,
                        content: nil,
                        type: nil,
                        tags: nil,
                        galaxies: nil,
                        position:
                            position.clamped(),
                        importance: nil
                    ),
                    sourceDiaryIDs: nil,
                    reason:
                        "Universe iOS 移动星球",
                    expectedVersion: version
                )
            }

            selectedNodeID = nodeID
            showNotice(
                "星球位置已更新"
            )
        } catch {
            showNotice(
                UniverseAPIService.userMessage(
                    for: error
                )
            )
        }
    }

    private func mutate(
        operation:
            (
                UniverseAPIService,
                Int
            ) async throws -> UniverseReadResult
    ) async throws {
        guard case .ready(let current) = state else {
            throw LeileiAPIError.invalidResponse
        }

        let service =
            UniverseAPIService(
                api: appModel.api
            )

        do {
            let mutation =
                try await operation(
                    service,
                    current.version
                )

            do {
                let authoritative =
                    try await service.load()
                state = .ready(
                    authoritative
                )
            } catch {
                let preservedSources =
                    mutation.sources
                    ?? current.sources
                state = .ready(
                    UniverseReadResult(
                        snapshot:
                            mutation.snapshot,
                        version:
                            mutation.version,
                        sources:
                            preservedSources
                    )
                )
            }
        } catch {
            if let fresh =
                try? await service.load() {
                state = .ready(fresh)
            } else {
                state = .ready(current)
            }
            throw error
        }
    }

    private func connections(
        for nodeID: String,
        in result: UniverseReadResult
    ) -> [UniverseNodeConnection] {
        let nodes = Dictionary(
            uniqueKeysWithValues:
                result.snapshot.nodes.map {
                    ($0.id, $0)
                }
        )

        return result.snapshot.relations
            .compactMap { relation in
                let relatedID: String

                if relation.source == nodeID {
                    relatedID = relation.target
                } else if relation.target
                    == nodeID {
                    relatedID = relation.source
                } else {
                    return nil
                }

                guard let node =
                    nodes[relatedID]
                else {
                    return nil
                }

                return UniverseNodeConnection(
                    relation: relation,
                    node: node
                )
            }
    }

    private func sources(
        for nodeID: String,
        in result: UniverseReadResult
    ) -> [UniverseDiarySourceSummary] {
        (result.sources ?? [])
            .filter {
                $0.nodeId == nodeID
            }
    }

    private func refreshReadyState() async {
        guard case .ready(let current) = state else {
            return
        }

        do {
            let fresh =
                try await UniverseAPIService(
                    api: appModel.api
                )
                .load()
            state = .ready(fresh)
        } catch {
            state = .ready(current)
        }
    }

    private func openRelatedNode(
        _ nodeID: String
    ) {
        sheetSelection = nil
        selectedNodeID = nodeID
    }

    private func openTargetIfPossible() async {
        guard let targetNodeID,
              case .ready(let result) = state,
              result.snapshot.nodes
                .contains(
                    where: {
                        $0.id == targetNodeID
                    }
                )
        else {
            return
        }

        selectedNodeID = targetNodeID
        sheetSelection = .node(
            targetNodeID
        )
        onTargetConsumed()
    }

    private func prepareExport(
        _ snapshot: UniverseSnapshot
    ) {
        let now = Date()
        let formatter =
            ISO8601DateFormatter()
        formatter.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds,
        ]

        let payload =
            UniverseExportPayload(
                snapshot: snapshot,
                exportedAt:
                    formatter.string(
                        from: now
                    )
            )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [
            .prettyPrinted,
            .sortedKeys,
        ]

        guard let data =
            try? encoder.encode(payload)
        else {
            showNotice(
                "导出未完成"
            )
            return
        }

        exportDocument =
            UniverseJSONDocument(
                data: data
            )

        let filenameFormatter =
            DateFormatter()
        filenameFormatter.locale =
            Locale(identifier: "en_US_POSIX")
        filenameFormatter.dateFormat =
            "yyyy-MM-dd"
        exportFilename =
            "蕾蕾宇宙备份-\(filenameFormatter.string(from: now))"
        exportPresented = true
    }

    private func showNotice(
        _ message: String
    ) {
        withAnimation(.snappy) {
            notice = message
        }

        Task { @MainActor in
            try? await Task.sleep(
                for: .seconds(3)
            )
            guard notice == message else {
                return
            }

            withAnimation(.snappy) {
                notice = nil
            }
        }
    }
}

private enum UniversePageState {
    case loading
    case notInitialized
    case failed
    case ready(UniverseReadResult)
}

private enum UniverseSheetSelection:
    Identifiable,
    Equatable {
    case node(String)
    case create(UniversePosition)

    var id: String {
        switch self {
        case .node(let id):
            return "node:\(id)"
        case .create(let position):
            return "create:\(position.x):\(position.y)"
        }
    }
}

private struct UniverseJSONDocument:
    FileDocument {
    static var readableContentTypes:
        [UTType] {
        [.json]
    }

    let data: Data

    init(data: Data) {
        self.data = data
    }

    init(
        configuration:
            ReadConfiguration
    ) throws {
        guard let data =
            configuration
                .file
                .regularFileContents
        else {
            throw CocoaError(
                .fileReadCorruptFile
            )
        }

        self.data = data
    }

    func fileWrapper(
        configuration:
            WriteConfiguration
    ) throws -> FileWrapper {
        FileWrapper(
            regularFileWithContents:
                data
        )
    }
}
