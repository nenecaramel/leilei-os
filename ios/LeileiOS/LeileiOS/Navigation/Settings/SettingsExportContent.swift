import SwiftUI

struct SettingsExportContent: View {
    let dataService: any SettingsDataService

    @State private var isExporting = false
    @State private var errorMessage: String?
    @State private var exportedDocument: SettingsExportDocument?

    var body: some View {
        Form {
            Section("Export") {
                Text(
                    "Full Backup excludes machine-local working directory paths. "
                    + "Mind includes Memory and retained historical records."
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }

            Section {
                Button {
                    Task {
                        await exportData()
                    }
                } label: {
                    HStack {
                        Text(isExporting ? "Exporting…" : "Create Full Backup")
                        Spacer()
                        if isExporting {
                            ProgressView()
                        }
                    }
                }
                .disabled(isExporting)

                if let exportedDocument {
                    ShareLink(item: exportedDocument.fileURL) {
                        Label("Share Export", systemImage: "square.and.arrow.up")
                    }
                }
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Color.settingsBackground)
    }

    @MainActor
    private func exportData() async {
        guard !isExporting else { return }
        isExporting = true
        errorMessage = nil
        exportedDocument = nil
        defer { isExporting = false }

        do {
            exportedDocument = try await dataService.exportData()
        } catch {
            errorMessage = settingsDataErrorMessage(error)
        }
    }
}
