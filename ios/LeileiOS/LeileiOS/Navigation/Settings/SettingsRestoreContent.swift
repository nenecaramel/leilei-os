import SwiftUI
import UniformTypeIdentifiers

struct SettingsRestoreContent: View {
    let dataService: any SettingsDataService

    @State private var isImporterPresented = false
    @State private var selectedFileURL: URL?
    @State private var preview: SettingsRestorePreview?
    @State private var isPreviewing = false
    @State private var isRestoring = false
    @State private var errorMessage: String?
    @State private var outcomeMessage: String?

    private var canRestore: Bool {
        preview?.canExecute == true && !isRestoring
    }

    var body: some View {
        Form {
            Section("Export File") {
                Button {
                    isImporterPresented = true
                } label: {
                    Label("Choose Export File", systemImage: "doc")
                }

                if let selectedFileURL {
                    LabeledContent("File", value: selectedFileURL.lastPathComponent)
                }

                if isPreviewing {
                    SettingsSectionState(
                        title: "Loading…",
                        isLoading: true
                    )
                }
            }

            if let preview {
                Section("Preview") {
                    LabeledContent("New", value: "\(preview.newCount)")
                    LabeledContent("Already Here", value: "\(preview.alreadyHereCount)")
                    LabeledContent("Conflicts", value: "\(preview.conflictCount)")
                    LabeledContent("Invalid", value: "\(preview.invalidCount)")
                }
            }

            Section {
                Button {
                    Task {
                        await restoreData()
                    }
                } label: {
                    HStack {
                        Text(isRestoring ? "Restoring…" : "Restore")
                        Spacer()
                        if isRestoring {
                            ProgressView()
                        }
                    }
                }
                .disabled(!canRestore)
            }

            if errorMessage != nil {
                Section {
                    SettingsSectionState(
                        title: "Failed"
                    )
                }
            }

            if let outcomeMessage {
                Section {
                    SettingsSectionState(
                        title: outcomeMessage == "Done"
                            ? "Done"
                            : "Failed"
                    )
                }
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Color.settingsBackground)
        .fileImporter(
            isPresented: $isImporterPresented,
            allowedContentTypes: [.json]
        ) { result in
            switch result {
            case .success(let url):
                selectedFileURL = url
                preview = nil
                errorMessage = nil
                outcomeMessage = nil
                Task {
                    await previewRestore(fileURL: url)
                }
            case .failure:
                errorMessage = "Failed"
            }
        }
    }

    @MainActor
    private func previewRestore(fileURL: URL) async {
        isPreviewing = true
        defer { isPreviewing = false }

        let accessedSecurityScopedResource = fileURL.startAccessingSecurityScopedResource()
        defer {
            if accessedSecurityScopedResource {
                fileURL.stopAccessingSecurityScopedResource()
            }
        }

        do {
            preview = try await dataService.previewRestore(fileURL: fileURL)
        } catch {
            errorMessage = "Failed"
        }
    }

    @MainActor
    private func restoreData() async {
        guard let selectedFileURL else { return }

        isRestoring = true
        errorMessage = nil
        outcomeMessage = nil
        defer { isRestoring = false }

        let accessedSecurityScopedResource = selectedFileURL.startAccessingSecurityScopedResource()
        defer {
            if accessedSecurityScopedResource {
                selectedFileURL.stopAccessingSecurityScopedResource()
            }
        }

        do {
            guard let preview else { return }
            let result = try await dataService.executeRestore(
                fileURL: selectedFileURL,
                previewFingerprint: preview.previewFingerprint
            )
            outcomeMessage = result.completed
                ? "Done"
                : "Failed"
        } catch {
            errorMessage = "Failed"
        }
    }
}
