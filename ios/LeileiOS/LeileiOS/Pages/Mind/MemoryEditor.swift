import SwiftUI

struct MemoryEditorSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var item: MindProductItem
    @State private var text: String
    @State private var hasDate: Bool
    @State private var date: Date
    @State private var saving = false
    @State private var message: String?
    @State private var conflict: MindProductItem?
    @State private var conflictUnresolved = false
    let onSaved: (MindProductItem) -> Void

    init(initialItem: MindProductItem, onSaved: @escaping (MindProductItem) -> Void) {
        _item = State(initialValue: initialItem)
        _text = State(initialValue: initialItem.text ?? "")
        _hasDate = State(initialValue: initialItem.occurredAt != nil)
        _date = State(initialValue: MemoryDate.parse(initialItem.occurredAt) ?? .now)
        self.onSaved = onSaved
    }
    private var isDirty: Bool {
        text != (item.text ?? "") || (hasDate ? date : nil) != MemoryDate.parse(item.occurredAt)
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("Memory") { TextEditor(text: $text).frame(minHeight: 180).disabled(saving) }
                Section("Occurred · 北京时间") {
                    Toggle("指定日期", isOn: $hasDate).disabled(saving)
                    if hasDate { DatePicker("发生时间", selection: $date).environment(\.timeZone, TimeZone(identifier: "Asia/Shanghai")!).disabled(saving) }
                }
                if let message { Section { Text(message).foregroundStyle(.secondary) } }
                if let conflict {
                    Section("最新内容") {
                        Text(conflict.text ?? "")
                        Text(MindPresentation.dateText(conflict.occurredAt) ?? "未指定日期")
                        Button("使用最新内容") {
                            item = conflict; text = conflict.text ?? ""; hasDate = conflict.occurredAt != nil
                            date = MemoryDate.parse(conflict.occurredAt) ?? .now
                            self.conflict = nil; conflictUnresolved = false; message = nil
                        }
                        Button("保留草稿继续编辑") { item = conflict; self.conflict = nil; conflictUnresolved = false; message = "请核对草稿后再次保存。" }
                    }
                }
                if conflictUnresolved && conflict == nil {
                    Button("读取最新内容") { Task { await readConflict() } }.disabled(saving)
                }
            }
            .navigationTitle("Edit Memory")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(saving || !isDirty || conflictUnresolved || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || text.count > 20_000)
                }
            }
            .interactiveDismissDisabled()
        }
    }
    @MainActor private func readConflict() async {
        saving = true
        defer { saving = false }
        do { conflict = try await appModel.api.mindItem(stateID: item.id); message = "内容已被修改。草稿已保留，请处理冲突。" }
        catch { message = "无法读取最新内容，请重试。草稿已保留。" }
    }
    @MainActor private func save() async {
        saving = true; message = nil
        do {
            let updated = try await appModel.api.updateMemory(item: item, text: text, occurredAt: hasDate ? date : nil)
            onSaved(updated); dismiss()
        } catch LeileiAPIError.backend(let status, _, _) where status == 409 {
            conflictUnresolved = true
            await readConflict()
        } catch { message = "无法保存，请重试。" }
        saving = false
    }
}
