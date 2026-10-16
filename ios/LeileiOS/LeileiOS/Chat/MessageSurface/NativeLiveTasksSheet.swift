import SwiftUI

struct NativeLiveTasksSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss
    let prepareID: String
    @State private var tasks: [NativeLiveTaskSnapshot] = []
    @State private var generationID: String?
    @State private var loading = true
    @State private var unavailable = false

    var body: some View {
        NavigationStack {
            List {
                if loading && generationID == nil {
                    Text("Loading…").foregroundStyle(.secondary)
                } else if unavailable {
                    Text("Unavailable").foregroundStyle(.secondary)
                    Button("Retry") { Task { await refresh() } }
                } else if tasks.isEmpty {
                    Text("Nothing here").foregroundStyle(.secondary)
                } else if let generationID {
                    ForEach(tasks) { task in
                        NavigationLink {
                            NativeLiveTaskOutputView(prepareID: prepareID, generationID: generationID, task: task)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(task.title)
                                Text(task.statusLabel).font(.caption).foregroundStyle(.secondary)
                                if let summary = task.summary, !summary.isEmpty {
                                    Text(summary).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Tasks")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .refreshable { await refresh() }
            .task {
                await refresh()
                while !Task.isCancelled && !unavailable {
                    do { try await Task.sleep(for: .seconds(3)) } catch { return }
                    await refresh()
                }
            }
        }
    }

    private func refresh() async {
        guard !Task.isCancelled else { return }
        loading = true
        defer { loading = false }
        do {
            let receipt = try await appModel.api.nativeLiveTaskControl(prepareID: prepareID, action: "list")
            try Task.checkCancellation()
            tasks = receipt.tasks ?? []
            generationID = receipt.generationId
            unavailable = false
        } catch {
            if !Task.isCancelled { tasks = []; generationID = nil; unavailable = true }
        }
    }
}

private struct NativeLiveTaskOutputView: View {
    @EnvironmentObject private var appModel: AppModel
    let prepareID: String
    let generationID: String
    let task: NativeLiveTaskSnapshot
    @State private var output: String?
    @State private var truncated = false
    @State private var unavailable = false
    @State private var stopRequested = false
    @State private var stopping = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(stopRequested ? "Stop requested" : task.statusLabel)
                    .font(.caption).foregroundStyle(.secondary)
                if unavailable {
                    Text("Unavailable").foregroundStyle(.secondary)
                } else if let output {
                    Text(output.isEmpty ? "Nothing here" : output)
                        .font(.system(.body, design: .monospaced)).textSelection(.enabled)
                    if truncated { Text("Showing the latest output").font(.caption).foregroundStyle(.secondary) }
                } else {
                    Text("Loading…").foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .navigationTitle(task.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Refresh") { Task { await readOutput() } }
                    if task.canStop {
                        Button("Stop", role: .destructive) { Task { await stop() } }
                            .disabled(stopping || stopRequested)
                    }
                } label: { Image(systemName: "ellipsis") }
            }
        }
        .task { await readOutput() }
    }

    private func readOutput() async {
        do {
            let receipt = try await appModel.api.nativeLiveTaskControl(prepareID: prepareID, action: "output", task: task, generationID: generationID)
            try Task.checkCancellation()
            output = receipt.output ?? ""
            truncated = receipt.truncated == true
            unavailable = false
        } catch { if !Task.isCancelled { output = nil; unavailable = true } }
    }

    private func stop() async {
        guard !stopping && !stopRequested else { return }
        stopping = true
        defer { stopping = false }
        // Keep disabled on uncertainty. Only a new list may establish actual state.
        stopRequested = true
        do {
            _ = try await appModel.api.nativeLiveTaskControl(prepareID: prepareID, action: "stop", task: task, generationID: generationID)
        } catch { unavailable = true }
    }
}
