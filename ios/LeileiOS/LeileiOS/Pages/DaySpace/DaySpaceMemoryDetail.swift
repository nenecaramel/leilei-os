import SwiftUI

private struct MemoryPaperDraft: Identifiable {
    var item: MindProductItem
    var text: String
    var conflict: MindProductItem?
    var unresolved = false
    var id: String { item.id }
    var dirty: Bool { text != (item.text ?? "") }
    init(_ item: MindProductItem) {
        self.item = item; text = item.text ?? ""
    }
}

struct DaySpaceMemoryDetail: View {
    @EnvironmentObject private var appModel: AppModel
    let date: String
    let onSaved: ([MindProductItem]) -> Void
    let onClosed: () -> Void
    @State private var drafts: [MemoryPaperDraft]
    @State private var saving = false
    @State private var message: String?
    @State private var discardConfirmation = false

    init(date: String, items: [MindProductItem], onSaved: @escaping ([MindProductItem]) -> Void, onClosed: @escaping () -> Void) {
        self.date = date; self.onSaved = onSaved; self.onClosed = onClosed
        _drafts = State(initialValue: items.map(MemoryPaperDraft.init))
    }
    private var dirty: Bool { drafts.contains { $0.dirty } }
    private var invalid: Bool {
        drafts.contains { $0.unresolved || $0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || $0.text.utf16.count > 20_000 }
    }
    var body: some View {
        DaySpacePaperDetailLayer(dateLabel: DaySpaceDate.paperLabel(date), errorMessage: message, onRequestClose: requestClose) {
            HStack(spacing: 5) {
                Button("Cancel", action: requestClose).disabled(saving)
                Text("·")
                Button(saving ? "Saving…" : "Save") { Task { await save() } }
                    .disabled(saving || !dirty || invalid)
            }
            .font(.system(size: 13)).foregroundStyle(Color(white: 0.43))
        } signature: {
            Text("Memory").font(.system(size: 20, weight: .medium, design: .serif)).foregroundStyle(Color(white: 0.52))
        } content: {
            VStack(alignment: .leading, spacing: 30) {
                ForEach($drafts) { $draft in
                    VStack(alignment: .leading, spacing: 0) {
                        DaySpacePaperBodyEditor(text: draft.text, disabled: saving, onTextChange: { draft.text = $0; message = nil }, minimumHeight: 30)
                        if draft.unresolved {
                            VStack(alignment: .leading, spacing: 8) {
                                if let latest = draft.conflict {
                                    Text("Latest content").font(.system(size: 13))
                                    Text(latest.text ?? "").textSelection(.enabled)
                                    Button("Use latest version") { draft = MemoryPaperDraft(latest); message = nil }
                                    Button("Keep my draft") { draft.item = latest; draft.conflict = nil; draft.unresolved = false; message = "Review your draft before saving again." }
                                } else {
                                    Button("Read latest version") { Task { await readConflict(id: draft.id) } }
                                }
                            }
                            .font(.system(size: 14)).foregroundStyle(Color(white: 0.15)).disabled(saving)
                        }
                    }
                }
            }
        }
        .confirmationDialog("放弃未保存的修改？", isPresented: $discardConfirmation, titleVisibility: .visible) {
            Button("放弃", role: .destructive, action: onClosed)
            Button("继续编辑", role: .cancel) {}
        }
    }
    private func requestClose() {
        guard !saving else { return }
        if dirty { discardConfirmation = true } else { onClosed() }
    }
    @MainActor private func readConflict(id: String) async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        do {
            let latest = try await appModel.api.mindItem(stateID: id)
            if let index = drafts.firstIndex(where: { $0.id == id }) { drafts[index].conflict = latest }
        } catch { message = "Unable to read latest content. Your draft is preserved." }
    }
    @MainActor private func save() async {
        guard !saving, !invalid else { return }
        saving = true; message = nil
        defer { saving = false }
        var committed: [MindProductItem] = []
        defer { if !committed.isEmpty { onSaved(committed) } }
        for index in drafts.indices where drafts[index].dirty {
            do {
                let updated = try await appModel.api.updateMemory(item: drafts[index].item, text: drafts[index].text, occurredAt: MemoryDate.parse(drafts[index].item.occurredAt))
                drafts[index] = MemoryPaperDraft(updated)
                committed.append(updated)
            } catch LeileiAPIError.backend(let status, _, _) where status == 409 {
                drafts[index].unresolved = true
                message = "Memory changed. Your draft is preserved; choose how to continue."
                do { drafts[index].conflict = try await appModel.api.mindItem(stateID: drafts[index].id) }
                catch { message = "Unable to read latest content. Your draft is preserved." }
                return
            } catch { message = "保存失败，请重试"; return }
        }
        onClosed()
    }
}
