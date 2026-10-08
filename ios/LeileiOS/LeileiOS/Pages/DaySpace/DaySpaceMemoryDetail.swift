import SwiftUI
struct DaySpaceMemoryDetail: View {
    @EnvironmentObject private var appModel: AppModel
    let date: String
    let items: [MindProductItem]
    let onChanged: () -> Void
    let onClosed: () -> Void
    @State private var current: [MindProductItem] = []
    @State private var editing: MindProductItem?
    @State private var failed = false
    @State private var revision = 0
    var body: some View {
        DaySpacePaperDetailLayer(
            dateLabel: DaySpaceDate.paperLabel(date),
            errorMessage: failed ? "Memory unavailable" : nil,
            onRequestClose: onClosed,
            topRight: { Button("Done", action: onClosed).font(.system(size: 13)) },
            signature: { Text("Memory").font(.system(size: 20, design: .serif)) }
        ) {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(current) { item in
                    Button { editing = item } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(item.text ?? "Memory").foregroundStyle(.primary)
                            Text("查看 / 编辑").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if failed { Button("Retry") { revision += 1 } }
            }
            .sheet(item: $editing) { item in
                MemoryEditorSheet(initialItem: item) { updated in
                    current = current.compactMap { entry in
                        guard entry.id == updated.id else { return entry }
                        guard let occurredAt = MemoryDate.parse(updated.occurredAt),
                              DaySpaceDate.businessDate(occurredAt) == date else { return nil }
                        return updated
                    }
                    revision += 1
                    onChanged()
                }
            }
            .task(id: revision) {
                if revision == 0 { current = items }
                do {
                    let latest = try await appModel.api.memoryDay(date)
                    try Task.checkCancellation()
                    current = latest
                    failed = false
                } catch {
                    if !Task.isCancelled { failed = true }
                }
            }
        }
    }
}
