import SwiftUI

struct UniverseNodeDraft: Equatable {
    struct MembershipDraft: Identifiable, Equatable {
        let id: String
        var weightText: String

        var percentText: String {
            guard let value = Double(weightText) else {
                return ""
            }
            return UniverseNodeDraft.numberText(value * 100)
        }
    }

    var title: String
    var summary: String
    var content: String
    var type: String
    var importance: String
    var tagsText: String
    var memberships: [MembershipDraft]
    var sourceDiaryIDs: [String]

    init(
        node: UniverseNode?,
        sourceDiaryIDs: [String]
    ) {
        title = node?.title ?? ""
        summary = node?.summary ?? ""
        content = node?.content ?? ""
        type = node?.type ?? "concept"
        importance = node?.importance ?? "normal"
        tagsText = (node?.tags ?? []).joined(separator: ", ")
        memberships = (node?.galaxies ?? []).map {
            MembershipDraft(
                id: $0.id,
                weightText: UniverseNodeDraft.numberText(
                    $0.weight
                )
            )
        }
        self.sourceDiaryIDs = sourceDiaryIDs
    }

    var tags: [String] {
        tagsText
            .replacingOccurrences(
                of: "，",
                with: ","
            )
            .split(separator: ",")
            .map {
                $0.trimmingCharacters(
                    in: .whitespacesAndNewlines
                )
            }
            .filter { !$0.isEmpty }
    }

    var canonicalMemberships:
        [UniverseGalaxyMembership]? {
        var seen = Set<String>()
        var result: [UniverseGalaxyMembership] = []

        for membership in memberships {
            guard seen.insert(membership.id).inserted,
                  let weight = Double(
                    membership.weightText
                        .trimmingCharacters(
                            in: .whitespacesAndNewlines
                        )
                  ),
                  weight.isFinite
            else {
                return nil
            }

            result.append(
                UniverseGalaxyMembership(
                    id: membership.id,
                    weight: weight
                )
            )
        }

        return result
    }

    static func numberText(
        _ value: Double
    ) -> String {
        String(
            format: "%.6g",
            value
        )
    }
}

struct UniverseNodeSheet: View {
    enum Mode: Equatable {
        case detail
        case create(UniversePosition)
    }

    let mode: Mode
    let node: UniverseNode?
    let galaxies: [UniverseGalaxy]
    let allNodes: [UniverseNode]
    let connections:
        [(relation: UniverseRelation, node: UniverseNode)]
    let sources: [UniverseDiarySourceSummary]
    let revisionsAvailable: Bool

    let onSearchDiarySources:
        (String) async throws -> [UniverseDiarySourceOption]
    let onSave:
        (UniverseNodeDraft, UniversePosition?) async throws -> Void
    let onDelete: (UniverseNode) async throws -> Void
    let onRestore: (UniverseNode) async throws -> Void
    let onCreateRelation:
        (UniverseRelationCreateInput) async throws -> Void
    let onDeleteRelation:
        (UniverseRelation) async throws -> Void
    let onOpenRelatedNode: (String) -> Void
    let onOpenDiarySource: (UniverseDiarySourceSummary) -> Void
    let onClose: () -> Void

    @State private var isEditing: Bool
    @State private var draft: UniverseNodeDraft
    @State private var sourceMetadata:
        [String: UniverseDiarySourceOption]
    @State private var sourcePickerPresented = false
    @State private var relationPresented = false
    @State private var deletePresented = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        mode: Mode,
        node: UniverseNode?,
        galaxies: [UniverseGalaxy],
        allNodes: [UniverseNode],
        connections:
            [(relation: UniverseRelation, node: UniverseNode)],
        sources: [UniverseDiarySourceSummary],
        revisionsAvailable: Bool,
        onSearchDiarySources:
            @escaping (String) async throws
                -> [UniverseDiarySourceOption],
        onSave:
            @escaping (
                UniverseNodeDraft,
                UniversePosition?
            ) async throws -> Void,
        onDelete:
            @escaping (UniverseNode) async throws -> Void,
        onRestore:
            @escaping (UniverseNode) async throws -> Void,
        onCreateRelation:
            @escaping (
                UniverseRelationCreateInput
            ) async throws -> Void,
        onDeleteRelation:
            @escaping (UniverseRelation) async throws -> Void,
        onOpenRelatedNode:
            @escaping (String) -> Void,
        onOpenDiarySource:
            @escaping (UniverseDiarySourceSummary) -> Void,
        onClose:
            @escaping () -> Void
    ) {
        self.mode = mode
        self.node = node
        self.galaxies = galaxies
        self.allNodes = allNodes
        self.connections = connections
        self.sources = sources
        self.revisionsAvailable = revisionsAvailable
        self.onSearchDiarySources = onSearchDiarySources
        self.onSave = onSave
        self.onDelete = onDelete
        self.onRestore = onRestore
        self.onCreateRelation = onCreateRelation
        self.onDeleteRelation = onDeleteRelation
        self.onOpenRelatedNode = onOpenRelatedNode
        self.onOpenDiarySource = onOpenDiarySource
        self.onClose = onClose

        let creating: Bool
        switch mode {
        case .create:
            creating = true
        case .detail:
            creating = false
        }

        _isEditing = State(initialValue: creating)
        _draft = State(
            initialValue: UniverseNodeDraft(
                node: node,
                sourceDiaryIDs: sources.map(\.diaryId)
            )
        )
        _sourceMetadata = State(
            initialValue: Dictionary(
                uniqueKeysWithValues: sources.map {
                    (
                        $0.diaryId,
                        UniverseDiarySourceOption(
                            id: $0.diaryId,
                            title: $0.title,
                            date: $0.date,
                            status: $0.status
                        )
                    )
                }
            )
        )
    }

    var body: some View {
        NavigationStack {
            Group {
                if isEditing {
                    editor
                } else if let node {
                    detail(node)
                } else {
                    ProgressView()
                }
            }
            .background(
                UniversePalette.background
                    .ignoresSafeArea()
            )
            .navigationTitle(
                isCreate
                    ? "点亮一颗新星"
                    : "Universe"
            )
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                toolbarContent
            }
        }
        .environment(\.colorScheme, .dark)
        .interactiveDismissDisabled(
            isSaving
        )
        .sheet(isPresented: $sourcePickerPresented) {
            UniverseDiarySourcePicker(
                initialSelection: draft.sourceDiaryIDs,
                initialMetadata: sourceMetadata,
                search: onSearchDiarySources
            ) { ids, metadata in
                draft.sourceDiaryIDs = ids
                sourceMetadata.merge(
                    metadata,
                    uniquingKeysWith: { _, new in new }
                )
            }
            .environment(\.colorScheme, .dark)
        }
        .sheet(isPresented: $relationPresented) {
            if let node {
                UniverseRelationSheet(
                    source: node,
                    nodes: relationCandidates,
                    onSave: { relation in
                        try await onCreateRelation(relation)
                    }
                )
                .environment(\.colorScheme, .dark)
            }
        }
        .confirmationDialog(
            "让它离开宇宙？",
            isPresented: $deletePresented,
            titleVisibility: .visible
        ) {
            Button(
                "让它离开宇宙",
                role: .destructive
            ) {
                guard let node else {
                    return
                }

                Task {
                    await delete(node)
                }
            }

            Button(
                "取消",
                role: .cancel
            ) {
            }
        }
        .onChange(of: node) { _, updated in
            guard !isEditing,
                  let updated
            else {
                return
            }

            draft = UniverseNodeDraft(
                node: updated,
                sourceDiaryIDs: sources.map(\.diaryId)
            )
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button {
                if isEditing, !isCreate {
                    isEditing = false
                    resetDraft()
                } else {
                    onClose()
                }
            } label: {
                if isEditing, !isCreate {
                    Text("取消")
                } else {
                    Image(systemName: "xmark")
                }
            }
            .disabled(isSaving)
        }

        ToolbarItemGroup(placement: .topBarTrailing) {
            if isEditing {
                Button {
                    Task {
                        await save()
                    }
                } label: {
                    if isSaving {
                        ProgressView()
                    } else {
                        Text(
                            isCreate
                                ? "点亮"
                                : "保存"
                        )
                    }
                }
                .disabled(!canSave)
            } else if let node {
                Button {
                    relationPresented = true
                } label: {
                    Image(systemName: "link")
                }
                .accessibilityLabel("建立思想连接")
                .disabled(isSaving)

                Button("编辑") {
                    resetDraft()
                    isEditing = true
                }
                .disabled(isSaving)

                Menu {
                    if revisionsAvailable {
                        Button {
                            Task {
                                await restore(node)
                            }
                        } label: {
                            Label(
                                "恢复上一版本",
                                systemImage: "clock.arrow.circlepath"
                            )
                        }
                    }

                    Button(
                        role: .destructive
                    ) {
                        deletePresented = true
                    } label: {
                        Label(
                            "让它离开宇宙",
                            systemImage: "trash"
                        )
                    }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel("更多星球操作")
                .disabled(isSaving)
            }
        }
    }

    private var editor: some View {
        ScrollView {
            VStack(
                alignment: .leading,
                spacing: 22
            ) {
                if let contextLine {
                    Text(contextLine)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                editorField(
                    title: "名称"
                ) {
                    TextField(
                        "一个概念、问题或经历",
                        text: $draft.title
                    )
                    .textInputAutocapitalization(.sentences)
                }

                editorField(
                    title: "为什么它值得留在你的宇宙？"
                ) {
                    TextField(
                        "摘要",
                        text: $draft.summary,
                        axis: .vertical
                    )
                    .lineLimit(2...5)
                }

                editorField(
                    title: "此刻的理解"
                ) {
                    TextEditor(
                        text: $draft.content
                    )
                    .frame(minHeight: 150)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .background(
                        UniversePalette.surface,
                        in: RoundedRectangle(
                            cornerRadius: 14,
                            style: .continuous
                        )
                    )
                }

                metadataEditor

                sourceEditor

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 24)
            .frame(
                maxWidth: 720,
                alignment: .leading
            )
            .frame(maxWidth: .infinity)
        }
    }

    private func detail(
        _ node: UniverseNode
    ) -> some View {
        ScrollView {
            VStack(
                alignment: .leading,
                spacing: 24
            ) {
                VStack(
                    alignment: .leading,
                    spacing: 9
                ) {
                    Text(
                        UniverseNodeOptions.typeLabel(
                            node.type
                        )
                    )
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)

                    Text(node.title)
                        .font(
                            .system(
                                size: 31,
                                weight: .semibold
                            )
                        )

                    if !node.summary.isEmpty {
                        Text(node.summary)
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }

                    Text(
                        "更新于 \(formattedDate(node.updatedAt))"
                    )
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                }

                if !node.content.isEmpty {
                    Text(node.content)
                        .font(.body)
                        .textSelection(.enabled)
                        .frame(
                            maxWidth: .infinity,
                            alignment: .leading
                        )
                }

                detailMetadata(node)

                if !connections.isEmpty {
                    connectionsSection
                }

                if !sources.isEmpty {
                    provenanceSection
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 28)
            .frame(
                maxWidth: 720,
                alignment: .leading
            )
            .frame(maxWidth: .infinity)
        }
    }

    private var metadataEditor: some View {
        VStack(
            alignment: .leading,
            spacing: 16
        ) {
            HStack(spacing: 14) {
                Menu {
                    Picker(
                        "",
                        selection: $draft.type
                    ) {
                        ForEach(
                            availableNodeTypes,
                            id: \.self
                        ) { type in
                            Text(
                                UniverseNodeOptions.typeLabel(
                                    type
                                )
                            )
                            .tag(type)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.inline)
                } label: {
                    metadataPill(
                        UniverseNodeOptions.typeLabel(
                            draft.type
                        )
                    )
                }

                Menu {
                    Picker(
                        "",
                        selection: $draft.importance
                    ) {
                        ForEach(
                            availableImportance,
                            id: \.self
                        ) { importance in
                            Text(importance)
                                .tag(importance)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.inline)
                } label: {
                    metadataPill(
                        draft.importance
                    )
                }
            }

            editorField(
                title: "标签"
            ) {
                TextField(
                    "自我观察, 认知演化",
                    text: $draft.tagsText
                )
            }

            VStack(
                alignment: .leading,
                spacing: 12
            ) {
                Text("星系")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)

                ForEach(
                    galaxies.sorted {
                        $0.order < $1.order
                    }
                ) { galaxy in
                    galaxyMembershipRow(galaxy)
                }
            }
        }
    }

    private var sourceEditor: some View {
        VStack(
            alignment: .leading,
            spacing: 10
        ) {
            HStack {
                Text("来源日记")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)

                Spacer()

                Button {
                    sourcePickerPresented = true
                } label: {
                    Label(
                        "添加",
                        systemImage: "plus"
                    )
                }
                .font(.subheadline)
            }

            if draft.sourceDiaryIDs.isEmpty {
                Text("没有关联来源")
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
            } else {
                ForEach(
                    draft.sourceDiaryIDs,
                    id: \.self
                ) { diaryID in
                    HStack(spacing: 10) {
                        VStack(
                            alignment: .leading,
                            spacing: 2
                        ) {
                            Text(
                                sourceMetadata[
                                    diaryID
                                ]?.title
                                    ?? diaryID
                            )
                            .lineLimit(1)

                            if let date =
                                sourceMetadata[
                                    diaryID
                                ]?.date {
                                Text(
                                    sourceDate(date)
                                )
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                        }

                        Spacer()

                        Button {
                            draft.sourceDiaryIDs
                                .removeAll {
                                    $0 == diaryID
                                }
                        } label: {
                            Image(
                                systemName:
                                    "xmark.circle.fill"
                            )
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                    }
                    .padding(12)
                    .background(
                        UniversePalette.surface,
                        in: RoundedRectangle(
                            cornerRadius: 12,
                            style: .continuous
                        )
                    )
                }
            }
        }
    }

    private func detailMetadata(
        _ node: UniverseNode
    ) -> some View {
        VStack(
            alignment: .leading,
            spacing: 12
        ) {
            HStack(
                spacing: 8
            ) {
                metadataPill(
                    UniverseNodeOptions.typeLabel(
                        node.type
                    )
                )
                metadataPill(
                    node.importance ?? "normal"
                )
            }

            if !node.tags.isEmpty {
                FlowLayout(
                    spacing: 8
                ) {
                    ForEach(
                        node.tags,
                        id: \.self
                    ) { tag in
                        Text("# \(tag)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .padding(
                                .horizontal,
                                10
                            )
                            .padding(
                                .vertical,
                                6
                            )
                            .background(
                                UniversePalette.surface,
                                in: Capsule()
                            )
                    }
                }
            }

            if !node.galaxies.isEmpty {
                VStack(
                    alignment: .leading,
                    spacing: 8
                ) {
                    Text("星系")
                        .font(
                            .subheadline.weight(
                                .medium
                            )
                        )
                        .foregroundStyle(.secondary)

                    ForEach(
                        node.galaxies
                    ) { membership in
                        let galaxy =
                            galaxies.first {
                                $0.id == membership.id
                            }

                        HStack(spacing: 8) {
                            Circle()
                                .fill(
                                    UniversePalette.color(
                                        hex: galaxy?.color
                                    )
                                )
                                .frame(
                                    width: 8,
                                    height: 8
                                )

                            Text(
                                galaxy?.title
                                    ?? membership.id
                            )

                            Spacer()

                            Text(
                                UniverseNodeDraft
                                    .numberText(
                                        membership.weight
                                            * 100
                                    )
                                + "%"
                            )
                            .foregroundStyle(.secondary)
                        }
                        .font(.subheadline)
                    }
                }
            }
        }
    }

    private var connectionsSection: some View {
        VStack(
            alignment: .leading,
            spacing: 8
        ) {
            Text("Connections")
                .font(.headline)

            ForEach(
                connections,
                id: \.relation.id
            ) { connection in
                HStack(spacing: 8) {
                    Button {
                        onOpenRelatedNode(
                            connection.node.id
                        )
                    } label: {
                        VStack(
                            alignment: .leading,
                            spacing: 2
                        ) {
                            Text(
                                connection.node.title
                            )
                            .foregroundStyle(.primary)

                            Text(
                                connection.relation
                                    .relationType.label
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        .frame(
                            maxWidth: .infinity,
                            alignment: .leading
                        )
                    }
                    .buttonStyle(.plain)

                    Menu {
                        Button(
                            role: .destructive
                        ) {
                            Task {
                                await deleteRelation(
                                    connection.relation
                                )
                            }
                        } label: {
                            Label(
                                "移除连接",
                                systemImage:
                                    "link.badge.minus"
                            )
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .frame(
                                width: 32,
                                height: 32
                            )
                    }
                    .accessibilityLabel("连接操作")
                }
                .padding(.vertical, 7)

                Divider()
                    .overlay(
                        UniversePalette.border
                    )
            }
        }
    }

    private var provenanceSection: some View {
        VStack(
            alignment: .leading,
            spacing: 10
        ) {
            Text("来源日记")
                .font(.headline)

            ForEach(
                sources.sorted {
                    if $0.date != $1.date {
                        return $0.date < $1.date
                    }
                    return $0.diaryId < $1.diaryId
                }
            ) { source in
                Button {
                    onOpenDiarySource(source)
                } label: {
                    HStack(spacing: 12) {
                        VStack(spacing: 0) {
                            Circle()
                                .fill(
                                    Color.secondary.opacity(
                                        0.75
                                    )
                                )
                                .frame(
                                    width: 6,
                                    height: 6
                                )

                            Rectangle()
                                .fill(
                                    Color.secondary.opacity(
                                        0.22
                                    )
                                )
                                .frame(
                                    width: 1,
                                    height: 32
                                )
                        }

                        VStack(
                            alignment: .leading,
                            spacing: 2
                        ) {
                            Text(
                                sourceDate(
                                    source.date
                                )
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)

                            HStack(spacing: 6) {
                                Text(source.title)
                                    .lineLimit(1)

                                if source.status
                                    == "archived" {
                                    Text("Archived")
                                        .font(.caption2)
                                        .foregroundStyle(
                                            .secondary
                                        )
                                }
                            }
                        }

                        Spacer()
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var contextLine: String? {
        if isCreate {
            return "新星 · 待点亮"
        }

        guard let node else {
            return nil
        }

        return "当前思想 · \(node.title)"
    }

    private var isCreate: Bool {
        if case .create = mode {
            return true
        }
        return false
    }

    private var createPosition: UniversePosition? {
        if case .create(let position) = mode {
            return position
        }
        return nil
    }

    private var canSave: Bool {
        !isSaving
            && !draft.title
                .trimmingCharacters(
                    in: .whitespacesAndNewlines
                )
                .isEmpty
            && draft.canonicalMemberships != nil
    }

    private var availableNodeTypes: [String] {
        var values = UniverseNodeOptions.types
        if !values.contains(draft.type) {
            values.append(draft.type)
        }
        return values
    }

    private var availableImportance: [String] {
        var values = UniverseNodeOptions.importance
        if !values.contains(draft.importance) {
            values.append(draft.importance)
        }
        return values
    }

    private var relationCandidates:
        [UniverseNode] {
        guard let node else {
            return []
        }

        return allNodes.filter {
            $0.id != node.id
        }
    }

    private func editorField<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(
            alignment: .leading,
            spacing: 7
        ) {
            Text(title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)

            content()
                .padding(
                    .horizontal,
                    12
                )
                .padding(
                    .vertical,
                    11
                )
                .background(
                    UniversePalette.surface,
                    in: RoundedRectangle(
                        cornerRadius: 12,
                        style: .continuous
                    )
                )
        }
    }

    private func metadataPill(
        _ text: String
    ) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding(
                .horizontal,
                10
            )
            .padding(
                .vertical,
                6
            )
            .background(
                UniversePalette.surface,
                in: Capsule()
            )
    }

    private func galaxyMembershipRow(
        _ galaxy: UniverseGalaxy
    ) -> some View {
        let index = draft.memberships
            .firstIndex {
                $0.id == galaxy.id
            }
        let enabled = index != nil

        return VStack(
            alignment: .leading,
            spacing: 8
        ) {
            Toggle(
                isOn: Binding(
                    get: {
                        draft.memberships
                            .contains {
                                $0.id == galaxy.id
                            }
                    },
                    set: { selected in
                        if selected {
                            if !draft.memberships
                                .contains(
                                    where: {
                                        $0.id
                                            == galaxy.id
                                    }
                                ) {
                                draft.memberships
                                    .append(
                                        .init(
                                            id: galaxy.id,
                                            weightText:
                                                "0.5"
                                        )
                                    )
                            }
                        } else {
                            draft.memberships
                                .removeAll {
                                    $0.id == galaxy.id
                                }
                        }
                    }
                )
            ) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(
                            UniversePalette.color(
                                hex: galaxy.color
                            )
                        )
                        .frame(
                            width: 8,
                            height: 8
                        )

                    Text(galaxy.title)
                }
            }

            if enabled,
               let currentIndex =
                    draft.memberships
                        .firstIndex(
                            where: {
                                $0.id == galaxy.id
                            }
                        ) {
                HStack {
                    Text("权重")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Spacer()

                    TextField(
                        "50",
                        text: Binding(
                            get: {
                                draft.memberships[
                                    currentIndex
                                ].percentText
                            },
                            set: { value in
                                let normalized =
                                    value.replacingOccurrences(
                                        of: "％",
                                        with: ""
                                    )
                                    .replacingOccurrences(
                                        of: "%",
                                        with: ""
                                    )
                                if normalized
                                    .trimmingCharacters(
                                        in:
                                            .whitespacesAndNewlines
                                    )
                                    .isEmpty {
                                    draft.memberships[
                                        currentIndex
                                    ].weightText = ""
                                } else if let percent =
                                    Double(normalized) {
                                    draft.memberships[
                                        currentIndex
                                    ].weightText =
                                        UniverseNodeDraft
                                            .numberText(
                                                percent / 100
                                            )
                                } else {
                                    draft.memberships[
                                        currentIndex
                                    ].weightText =
                                        normalized
                                }
                            }
                        )
                    )
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 72)

                    Text("%")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.leading, 28)
            }
        }
        .padding(12)
        .background(
            UniversePalette.surface,
            in: RoundedRectangle(
                cornerRadius: 12,
                style: .continuous
            )
        )
    }

    private func save() async {
        guard canSave else {
            return
        }

        isSaving = true
        errorMessage = nil
        defer {
            isSaving = false
        }

        do {
            try await onSave(
                draft,
                createPosition
            )

            if isCreate {
                onClose()
            } else {
                isEditing = false
            }
        } catch {
            errorMessage =
                UniverseAPIService.userMessage(
                    for: error
                )
        }
    }

    private func delete(
        _ node: UniverseNode
    ) async {
        isSaving = true
        errorMessage = nil
        defer {
            isSaving = false
        }

        do {
            try await onDelete(node)
            onClose()
        } catch {
            errorMessage =
                UniverseAPIService.userMessage(
                    for: error
                )
        }
    }

    private func restore(
        _ node: UniverseNode
    ) async {
        isSaving = true
        errorMessage = nil
        defer {
            isSaving = false
        }

        do {
            try await onRestore(node)
        } catch {
            errorMessage =
                UniverseAPIService.userMessage(
                    for: error
                )
        }
    }

    private func deleteRelation(
        _ relation: UniverseRelation
    ) async {
        isSaving = true
        errorMessage = nil
        defer {
            isSaving = false
        }

        do {
            try await onDeleteRelation(
                relation
            )
        } catch {
            errorMessage =
                UniverseAPIService.userMessage(
                    for: error
                )
        }
    }

    private func resetDraft() {
        draft = UniverseNodeDraft(
            node: node,
            sourceDiaryIDs:
                sources.map(\.diaryId)
        )
    }

    private func formattedDate(
        _ value: String
    ) -> String {
        let fractional =
            ISO8601DateFormatter()
        fractional.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds,
        ]

        let standard =
            ISO8601DateFormatter()
        standard.formatOptions = [
            .withInternetDateTime,
        ]

        guard let date =
            fractional.date(from: value)
                ?? standard.date(
                    from: value
                )
        else {
            return value
        }

        return date.formatted(
            date: .abbreviated,
            time: .omitted
        )
    }

    private func sourceDate(
        _ value: String
    ) -> String {
        let prefix = String(
            value.prefix(10)
        )
        let parts = prefix.split(
            separator: "-"
        )

        guard parts.count == 3 else {
            return prefix
        }

        return "\(parts[0]).\(parts[1]).\(parts[2])"
    }
}

private struct UniverseRelationSheet: View {
    let source: UniverseNode
    let nodes: [UniverseNode]
    let onSave:
        (UniverseRelationCreateInput) async throws -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var targetID = ""
    @State private var relationType:
        UniverseRelationType = .relatedTo
    @State private var strength = 0.7
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent(
                        "当前思想",
                        value: source.title
                    )
                }

                Section {
                    Picker(
                        "连接到",
                        selection: $targetID
                    ) {
                        Text("选择另一个思想")
                            .tag("")

                        ForEach(nodes) { node in
                            Text(node.title)
                                .tag(node.id)
                        }
                    }

                    Picker(
                        "关系",
                        selection: $relationType
                    ) {
                        ForEach(
                            UniverseRelationType.allCases
                        ) { type in
                            Text(
                                type.standaloneLabel
                            )
                            .tag(type)
                        }
                    }
                }

                Section(
                    "连接强度"
                ) {
                    Slider(
                        value: $strength,
                        in: 0...1,
                        step: 0.1
                    )

                    HStack {
                        Spacer()
                        Text(
                            "\(Int((strength * 100).rounded()))%"
                        )
                        .foregroundStyle(.secondary)
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(
                UniversePalette.background
            )
            .navigationTitle(
                "连接另一个思想"
            )
            .navigationBarTitleDisplayMode(
                .inline
            )
            .toolbar {
                ToolbarItem(
                    placement: .cancellationAction
                ) {
                    Button("取消") {
                        dismiss()
                    }
                    .disabled(isSaving)
                }

                ToolbarItem(
                    placement: .confirmationAction
                ) {
                    Button {
                        Task {
                            await save()
                        }
                    } label: {
                        if isSaving {
                            ProgressView()
                        } else {
                            Text("建立连接")
                        }
                    }
                    .disabled(
                        isSaving
                            || targetID.isEmpty
                    )
                }
            }
        }
    }

    private func save() async {
        guard !targetID.isEmpty else {
            return
        }

        isSaving = true
        errorMessage = nil
        defer {
            isSaving = false
        }

        do {
            try await onSave(
                UniverseRelationCreateInput(
                    source: source.id,
                    target: targetID,
                    relationType: relationType,
                    strength: strength
                )
            )
            dismiss()
        } catch {
            errorMessage =
                UniverseAPIService.userMessage(
                    for: error
                )
        }
    }
}

private struct UniverseDiarySourcePicker: View {
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

    @State private var query = ""
    @State private var selected:
        Set<String>
    @State private var metadata:
        [String: UniverseDiarySourceOption]
    @State private var results:
        [UniverseDiarySourceOption] = []
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
                    List(results) { option in
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
                "选择来源日记"
            )
            .navigationBarTitleDisplayMode(
                .inline
            )
            .searchable(
                text: $query,
                prompt: "搜索标题、日期或标签"
            )
            .toolbar {
                ToolbarItem(
                    placement: .cancellationAction
                ) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(
                    placement: .confirmationAction
                ) {
                    Button("完成") {
                        let ordered =
                            selected.sorted {
                                left,
                                right in
                                let leftDate =
                                    metadata[
                                        left
                                    ]?.date ?? ""
                                let rightDate =
                                    metadata[
                                        right
                                    ]?.date ?? ""
                                if leftDate
                                    != rightDate {
                                    return leftDate
                                        < rightDate
                                }
                                return left < right
                            }

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
    }

    private func load() async {
        state = .loading

        do {
            let response =
                try await search(query)
            guard !Task.isCancelled else {
                return
            }

            results = response
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

    private enum PickerState {
        case loading
        case ready
        case unavailable
    }
}

private struct FlowLayout:
    Layout {
    let spacing: CGFloat

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        let width =
            proposal.width
            ?? .greatestFiniteMagnitude
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size =
                subview.sizeThatFits(
                    .unspecified
                )

            if x > 0,
               x + size.width > width {
                x = 0
                y += lineHeight + spacing
                lineHeight = 0
            }

            x += size.width + spacing
            lineHeight = max(
                lineHeight,
                size.height
            )
        }

        return CGSize(
            width:
                proposal.width
                    ?? max(0, x - spacing),
            height: y + lineHeight
        )
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        var x = bounds.minX
        var y = bounds.minY
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size =
                subview.sizeThatFits(
                    .unspecified
                )

            if x > bounds.minX,
               x + size.width
                    > bounds.maxX {
                x = bounds.minX
                y += lineHeight + spacing
                lineHeight = 0
            }

            subview.place(
                at: CGPoint(
                    x: x,
                    y: y
                ),
                anchor: .topLeading,
                proposal:
                    ProposedViewSize(
                        width: size.width,
                        height: size.height
                    )
            )

            x += size.width + spacing
            lineHeight = max(
                lineHeight,
                size.height
            )
        }
    }
}
