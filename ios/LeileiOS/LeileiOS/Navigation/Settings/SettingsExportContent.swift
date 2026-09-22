import SwiftUI

struct SettingsExportContent: View {
    let dataService: any SettingsDataService

    @State private var selectedScope: SettingsExportScope = .all
    @State private var includesAuditAndLifecycleEvents = false
    @State private var isExporting = false
    @State private var errorMessage: String?
    @State private var exportedDocument: SettingsExportDocument?

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            SettingsDetailCard {
                ForEach(Array(SettingsExportScope.allCases.enumerated()), id: \.element.id) { index, scope in
                    Button {
                        selectedScope = scope
                    } label: {
                        HStack {
                            Text(scope.title)
                                .font(.system(size: 17, weight: .medium))
                            Spacer()
                            if selectedScope == scope {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 16, weight: .semibold))
                            }
                        }
                        .frame(height: 55)
                        .padding(.horizontal, 16)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    if index < SettingsExportScope.allCases.count - 1 {
                        SettingsDivider()
                    }
                }
            }

            SettingsDetailCard {
                Toggle("Include audit & lifecycle events", isOn: $includesAuditAndLifecycleEvents)
                    .font(.system(size: 17, weight: .medium))
                    .frame(height: 55)
                    .padding(.horizontal, 16)
            }

            Button {
                Task {
                    await exportData()
                }
            } label: {
                HStack(spacing: 8) {
                    if isExporting {
                        ProgressView()
                    }
                    Text("Export")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(isExporting)

            if let errorMessage {
                SettingsUnavailableState(message: errorMessage)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 23, style: .continuous))
            }
        }
        .sheet(item: $exportedDocument) { document in
            ShareLink(item: document.fileURL) {
                Text("Share Export")
            }
        }
    }

    @MainActor
    private func exportData() async {
        isExporting = true
        errorMessage = nil
        defer { isExporting = false }

        do {
            exportedDocument = try await dataService.exportData(
                SettingsExportRequest(
                    scope: selectedScope,
                    includeAuditAndLifecycleEvents: includesAuditAndLifecycleEvents
                )
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
