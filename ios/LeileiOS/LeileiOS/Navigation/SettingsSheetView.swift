import SwiftUI

struct SettingsSheetView: View {
    let dataService: any SettingsDataService
    @ObservedObject var appModel: AppModel

    @Environment(\.dismiss) private var dismiss
    @State private var path: [SettingsDetailPage] = []

    init(
        appModel: AppModel,
        dataService: any SettingsDataService = UnavailableSettingsDataService()
    ) {
        self.appModel = appModel
        self.dataService = dataService
    }

    var body: some View {
        NavigationStack(path: $path) {
            SettingsHomeContent(appModel: appModel)
                .navigationTitle("Settings")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button {
                            dismiss()
                        } label: {
                            Image(systemName: "xmark")
                        }
                        .accessibilityLabel("Close Settings")
                    }
                }
                .navigationDestination(for: SettingsDetailPage.self) { page in
                    SettingsDetailLayer(
                        page: page,
                        dataService: dataService
                    )
                }
        }
        .tint(.primary)
    }
}

enum SettingsDetailPage: Hashable {
    case summary
    case export
    case restore
    case status
    case activity
    case about

    var title: String {
        switch self {
        case .summary:
            "Summary"
        case .export:
            "Export"
        case .restore:
            "Restore"
        case .status:
            "Status"
        case .activity:
            "Activity"
        case .about:
            "About"
        }
    }
}

private struct SettingsDetailLayer: View {
    let page: SettingsDetailPage
    let dataService: any SettingsDataService

    var body: some View {
        detailContent
            .navigationTitle(page.title)
            .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private var detailContent: some View {
        switch page {
        case .summary:
            SettingsSummaryContent(dataService: dataService)
        case .export:
            SettingsExportContent(dataService: dataService)
        case .restore:
            SettingsRestoreContent(dataService: dataService)
        case .status:
            SettingsStatusContent(dataService: dataService)
        case .activity:
            SettingsActivityContent(dataService: dataService)
        case .about:
            SettingsAboutContent()
        }
    }
}
