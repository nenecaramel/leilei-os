import SwiftUI

struct SettingsExportContent: View {
    let dataService: any SettingsDataService

    @State private var includesAuditAndLifecycleEvents = false
    @State private var isExporting = false
    @State private var errorMessage: String?
    @State private var exportedDocument: SettingsExportDocument?

    var body: some View {
        Form {
            Section("Export") {
                Toggle(
                    "Include audit & lifecycle events",
                    isOn: $includesAuditAndLifecycleEvents
                )

                Text(
                    "Audit and lifecycle events are diagnostic only and are not restored. "
                    + "Full Backup excludes machine-local Workspace paths."
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
        isExporting = true
        errorMessage = nil
        exportedDocument = nil
        defer { isExporting = false }

        do {
            exportedDocument = try await dataService.exportData(
                SettingsExportRequest(
                    includeAuditAndLifecycleEvents: includesAuditAndLifecycleEvents
                )
            )
        } catch {
            errorMessage = settingsDataErrorMessage(error)
        }
    }
}
