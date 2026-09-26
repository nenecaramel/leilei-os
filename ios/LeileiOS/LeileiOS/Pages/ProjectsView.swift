import SwiftUI

struct ProjectsView: View {
    @State private var query = ""
    @State private var showingWorkspacePicker = false

    var body: some View {
        AppStateSurface(title: "Nothing here")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemBackground))
            .searchable(text: $query, prompt: "Search")
            .sheet(isPresented: $showingWorkspacePicker) {
                WorkspacePickerSheet()
            }
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Projects")
                        .font(.headline)
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            showingWorkspacePicker = true
                        } label: {
                            Label(
                                "Workspace",
                                systemImage: "externaldrive"
                            )
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 18, weight: .medium))
                    }
                    .accessibilityLabel("Project options")
                }

                if #available(iOS 26.0, *) {
                    DefaultToolbarItem(
                        kind: .search,
                        placement: .bottomBar
                    )
                }
            }
    }
}


struct WorkspacePickerSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            AppStateSurface(title: "Nothing here")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.settingsBackground)
                .navigationTitle("Workspace")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") {
                            dismiss()
                        }
                    }
                }
        }
        .background(Color.settingsBackground)
    }
}


struct ProjectPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String

    var body: some View {
        NavigationStack {
            AppStateSurface(title: "Nothing here")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.settingsBackground)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") {
                            dismiss()
                        }
                    }
                }
        }
        .background(Color.settingsBackground)
    }
}


struct ContextOverviewSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Context") {
                    LabeledContent("Usage") {
                        Text("—")
                            .foregroundStyle(.secondary)
                    }

                    LabeledContent("Model") {
                        Text("—")
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Compaction") {
                    LabeledContent("Status") {
                        Text("—")
                            .foregroundStyle(.secondary)
                    }

                    LabeledContent("Threshold") {
                        Text("—")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Color.settingsBackground)
            .navigationTitle("Context")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .background(Color.settingsBackground)
    }
}
