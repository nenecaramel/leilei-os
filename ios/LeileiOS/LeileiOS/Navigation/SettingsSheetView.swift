import SwiftUI
import UIKit
import UserNotifications

extension Color {
    static let settingsBackground = Color(
        red: 0.965,
        green: 0.965,
        blue: 0.97
    )
}

struct SettingsSectionState: View {
    let title: String
    var actionTitle: String? = nil
    var isLoading = false
    var action: (() -> Void)? = nil

    var body: some View {
        HStack {
            Text(title)
                .font(.body)
                .foregroundStyle(.secondary)

            Spacer()

            if isLoading {
                ProgressView()
                    .controlSize(.small)
            }

            if let actionTitle,
               let action {
                Button(actionTitle, action: action)
            }
        }
        .frame(
            maxWidth: .infinity,
            minHeight: 44,
            alignment: .leading
        )
    }
}

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

private enum SettingsDetailPage: Hashable {
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

private struct SettingsHomeContent: View {
    @ObservedObject var appModel: AppModel

    @AppStorage("appearanceMode") private var appearanceModeRawValue = AppearanceMode.system.rawValue
    @Environment(\.scenePhase) private var scenePhase
    @State private var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @State private var showingSignOutConfirmation = false
    @State private var authErrorMessage: String?

    var body: some View {
        Form {
            Section("Account") {
                LabeledContent {
                    Text(
                        appModel.accountEmail
                            ?? (appModel.isAuthenticated ? "Signed in" : "Not signed in")
                    )
                    .foregroundStyle(.secondary)
                } label: {
                    Label("Email", systemImage: "envelope")
                }

                LabeledContent {
                    Text("Auth0")
                        .foregroundStyle(.secondary)
                } label: {
                    Label("Sign-in provider", systemImage: "person.badge.key")
                }

                if appModel.isAuthenticated {
                    Button(role: .destructive) {
                        showingSignOutConfirmation = true
                    } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                } else {
                    Button {
                        Task {
                            await signIn()
                        }
                    } label: {
                        Label("Sign in", systemImage: "rectangle.portrait.and.arrow.forward")
                    }
                }
            }

            Section("Preferences") {
                Picker(selection: $appearanceModeRawValue) {
                    ForEach(AppearanceMode.allCases, id: \.rawValue) { mode in
                        Text(mode.title)
                            .tag(mode.rawValue)
                    }
                } label: {
                    Label("Appearance", systemImage: "circle.lefthalf.filled")
                }
                .pickerStyle(.menu)

                Button {
                    Task {
                        await handleNotificationsTap()
                    }
                } label: {
                    LabeledContent {
                        Text(notificationStatusTitle)
                            .foregroundStyle(.secondary)
                    } label: {
                        Label("Notifications", systemImage: "bell")
                    }
                }
                .foregroundStyle(.primary)
            }

            Section("Data") {
                NavigationLink(value: SettingsDetailPage.summary) {
                    Label("Summary", systemImage: "chart.bar")
                }

                NavigationLink(value: SettingsDetailPage.export) {
                    Label("Export", systemImage: "square.and.arrow.up")
                }

                NavigationLink(value: SettingsDetailPage.restore) {
                    Label("Restore", systemImage: "square.and.arrow.down")
                }
            }

            Section("System") {
                NavigationLink(value: SettingsDetailPage.status) {
                    Label("Status", systemImage: "network")
                }

                NavigationLink(value: SettingsDetailPage.activity) {
                    Label("Activity", systemImage: "clock.arrow.circlepath")
                }

                NavigationLink(value: SettingsDetailPage.about) {
                    Label("About", systemImage: "info.circle")
                }
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Color.settingsBackground)
        .task {
            await refreshAuthorizationStatus()
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            Task {
                await refreshAuthorizationStatus()
            }
        }
        .confirmationDialog(
            "Sign Out?",
            isPresented: $showingSignOutConfirmation,
            titleVisibility: .visible
        ) {
            Button("Sign Out", role: .destructive) {
                Task {
                    await signOut()
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .alert(
            "Authentication failed",
            isPresented: Binding(
                get: { authErrorMessage != nil },
                set: { if !$0 { authErrorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(authErrorMessage ?? "")
        }
    }

    private var notificationStatusTitle: String {
        switch authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            "On"
        case .denied:
            "Off"
        case .notDetermined:
            "Not Set"
        @unknown default:
            "Not Set"
        }
    }

    @MainActor
    private func signIn() async {
        do {
            try await appModel.signIn()
        } catch {
            authErrorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func signOut() async {
        do {
            try await appModel.signOut()
        } catch {
            authErrorMessage = error.localizedDescription
        }
    }

    private func handleNotificationsTap() async {
        if authorizationStatus == .notDetermined {
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(
                options: [.alert, .sound, .badge]
            )
            await refreshAuthorizationStatus()
            return
        }

        guard let url = URL(string: UIApplication.openNotificationSettingsURLString) else {
            return
        }
        await UIApplication.shared.open(url)
    }

    @MainActor
    private func refreshAuthorizationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorizationStatus = settings.authorizationStatus
    }
}

private struct SettingsSummaryContent: View {
    let dataService: any SettingsDataService

    @State private var summary: SettingsDataSummary?
    @State private var isLoading = true

    var body: some View {
        Form {
            Section("Summary") {
                LabeledContent("Diary", value: diaryValue)
                LabeledContent("Diary comments", value: countValue(\.diaryComments))
                LabeledContent("Todo", value: countValue(\.todo))
                LabeledContent("Conversations", value: conversationsValue)
                LabeledContent("Mind", value: countValue(\.mind))
                LabeledContent("Universe", value: universeValue)
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Color.settingsBackground)
        .task {
            await loadSummary()
        }
    }

    private var diaryValue: String {
        if let summary {
            return "\(summary.diaryActive) active · \(summary.diaryArchived) archived"
        }
        return placeholder
    }

    private var conversationsValue: String {
        if let summary {
            return "\(summary.conversationsActive) active · \(summary.conversationsArchived) archived"
        }
        return placeholder
    }

    private var universeValue: String {
        if let summary {
            return "\(summary.universeNodes) nodes"
        }
        return placeholder
    }

    private var placeholder: String {
        isLoading ? "Loading…" : "Unavailable"
    }

    private func countValue(
        _ keyPath: KeyPath<SettingsDataSummary, Int>
    ) -> String {
        guard let summary else { return placeholder }
        return "\(summary[keyPath: keyPath])"
    }

    @MainActor
    private func loadSummary() async {
        isLoading = true
        defer { isLoading = false }

        do {
            summary = try await dataService.readDataSummary()
        } catch {
            summary = nil
        }
    }
}
