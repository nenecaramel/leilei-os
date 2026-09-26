import SwiftUI

struct ProjectsView: View {
    @State private var showingWorkspacePicker = false

    var body: some View {
        List {
            Section("Workspace") {
                LabeledContent("Current Workspace") {
                    Text("Not connected")
                        .foregroundStyle(.secondary)
                }

                Button("Change Workspace") {
                    showingWorkspacePicker = true
                }
            }

            Section("Projects") {
                ContentUnavailableView(
                    "No Projects",
                    systemImage: "folder",
                    description: Text(
                        "Projects will appear here when project data is connected."
                    )
                )
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            }
        }
        .sheet(isPresented: $showingWorkspacePicker) {
            WorkspacePickerSheet()
        }
    }
}


struct WorkspacePickerSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Workspace") {
                    ContentUnavailableView(
                        "No Workspace Connected",
                        systemImage: "externaldrive",
                        description: Text(
                            "Available Mac workspaces will appear here."
                        )
                    )
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }
            }
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
    }
}


struct ProjectPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String

    var body: some View {
        NavigationStack {
            List {
                Section("Projects") {
                    ContentUnavailableView(
                        "No Projects",
                        systemImage: "folder",
                        description: Text(
                            "Available projects will appear here."
                        )
                    )
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }
            }
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
    }
}


struct ContextOverviewSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
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
    }
}
