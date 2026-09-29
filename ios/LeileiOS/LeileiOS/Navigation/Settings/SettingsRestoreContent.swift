import SwiftUI
import UniformTypeIdentifiers

struct SettingsRestoreContent: View {
    let dataService: any SettingsDataService

    @State private var isImporterPresented = false
    @State private var selectedFileURL: URL?
    @State private var preview: SettingsRestorePreview?
    @State private var restoreResult: SettingsRestoreResult?
    @State private var isPreviewing = false
    @State private var isRestoring = false
    @State private var errorMessage: String?

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
                    LabeledContent(
                        "Format",
                        value: "v\(preview.schemaVersion)"
                    )
                    LabeledContent(
                        "Exported",
                        value: formattedExportedAt(preview.exportedAt)
                    )
                    LabeledContent(
                        "Size",
                        value: formattedBytes(preview.rawBytes)
                    )
                    LabeledContent(
                        "Audit",
                        value: preview.auditIncluded
                            ? "Included · diagnostic only"
                            : "Not included"
                    )

                    ForEach(preview.modules) { module in
                        LabeledContent(
                            module.module.title,
                            value: moduleValue(module)
                        )
                    }

                    LabeledContent("New", value: "\(preview.newCount)")
                    LabeledContent(
                        "Already Here",
                        value: "\(preview.alreadyHereCount)"
                    )
                    LabeledContent(
                        "Conflicts",
                        value: "\(preview.conflictCount)"
                    )
                    LabeledContent(
                        "Invalid",
                        value: "\(preview.invalidCount)"
                    )

                    if preview.conflictCount > 0 || preview.invalidCount > 0 {
                        Text(
                            "Restore is add-only. Existing data is never overwritten, "
                            + "so nothing will be written while conflicts or invalid records remain."
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    } else if preview.newCount == 0 {
                        Text("Everything in this backup is already here.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Restore only adds missing data. Existing data is never overwritten.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
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

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .foregroundStyle(.secondary)
                }
            }

            if let restoreResult {
                Section("Restored") {
                    ForEach(restoreResult.modules) { module in
                        LabeledContent(
                            module.module.title,
                            value: moduleValue(module)
                        )
                    }

                    if restoreResult.completed {
                        SettingsSectionState(title: "Done")
                    }
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
                restoreResult = nil
                errorMessage = nil
                Task {
                    await previewRestore(fileURL: url)
                }
            case .failure:
                errorMessage = "Unable to choose this backup file."
            }
        }
    }

    @MainActor
    private func previewRestore(fileURL: URL) async {
        isPreviewing = true
        errorMessage = nil
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
            preview = nil
            errorMessage = settingsDataErrorMessage(error)
        }
    }

    @MainActor
    private func restoreData() async {
        guard let selectedFileURL else { return }

        isRestoring = true
        errorMessage = nil
        restoreResult = nil
        defer { isRestoring = false }

        let accessedSecurityScopedResource = selectedFileURL.startAccessingSecurityScopedResource()
        defer {
            if accessedSecurityScopedResource {
                selectedFileURL.stopAccessingSecurityScopedResource()
            }
        }

        do {
            guard let preview else { return }
            restoreResult = try await dataService.executeRestore(
                fileURL: selectedFileURL,
                previewFingerprint: preview.previewFingerprint
            )
        } catch {
            errorMessage = settingsDataErrorMessage(error)
        }
    }

    private func moduleValue(
        _ module: SettingsRestoreModuleResult
    ) -> String {
        var parts: [String] = []
        if module.newCount > 0 {
            parts.append("\(module.newCount) new")
        }
        if module.alreadyHereCount > 0 {
            parts.append("\(module.alreadyHereCount) already here")
        }
        if module.conflictCount > 0 {
            parts.append("\(module.conflictCount) conflict")
        }
        if module.invalidCount > 0 {
            parts.append("\(module.invalidCount) invalid")
        }
        return parts.isEmpty ? "No records" : parts.joined(separator: " · ")
    }

    private func formattedBytes(_ bytes: Int) -> String {
        ByteCountFormatter.string(
            fromByteCount: Int64(bytes),
            countStyle: .file
        )
    }

    private func formattedExportedAt(_ value: String) -> String {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds
        ]
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]

        guard let date = fractional.date(from: value) ?? standard.date(from: value) else {
            return value
        }
        return date.formatted(
            date: .abbreviated,
            time: .shortened
        )
    }
}
