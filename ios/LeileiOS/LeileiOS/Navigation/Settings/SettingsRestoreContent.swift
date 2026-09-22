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
        preview != nil && preview?.invalidCount == 0 && !isRestoring
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            SettingsDetailCard {
                Button {
                    isImporterPresented = true
                } label: {
                    HStack {
                        Text("Choose Export File")
                            .font(.system(size: 17, weight: .medium))
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.secondary)
                    }
                    .frame(height: 55)
                    .padding(.horizontal, 16)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if let selectedFileURL {
                    SettingsDivider()
                    SettingsDetailValueRow(
                        title: "File",
                        value: selectedFileURL.lastPathComponent
                    )
                }
            }

            if isPreviewing {
                ProgressView()
                    .frame(maxWidth: .infinity)
            }

            if let preview {
                SettingsDetailCard {
                    SettingsDetailValueRow(title: "New", value: "\(preview.newCount)")
                    SettingsDivider()
                    SettingsDetailValueRow(title: "Already Here", value: "\(preview.alreadyHereCount)")
                    SettingsDivider()
                    SettingsDetailValueRow(title: "Conflicts", value: "\(preview.conflictCount)")
                    SettingsDivider()
                    SettingsDetailValueRow(title: "Invalid", value: "\(preview.invalidCount)")
                }
            }

            Button {
                Task {
                    await restoreData()
                }
            } label: {
                HStack(spacing: 8) {
                    if isRestoring {
                        ProgressView()
                    }
                    Text("Restore")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!canRestore)

            if let errorMessage {
                SettingsUnavailableState(message: errorMessage)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 23, style: .continuous))
            }

            if let outcomeMessage {
                SettingsUnavailableState(message: outcomeMessage)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 23, style: .continuous))
            }
        }
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
            case .failure(let error):
                errorMessage = error.localizedDescription
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
            errorMessage = error.localizedDescription
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
            let result = try await dataService.executeRestore(fileURL: selectedFileURL)
            outcomeMessage = result.completed ? "Restore completed." : "Restore did not complete."
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
