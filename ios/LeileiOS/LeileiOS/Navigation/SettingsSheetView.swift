import SwiftUI
import UIKit
import UserNotifications

struct SettingsSheetView: View {
    let isPresented: Bool
    let onDismiss: () -> Void
    let dataService: any SettingsDataService
    @ObservedObject var appModel: AppModel
    @State private var path: [SettingsDetailPage] = []

    init(
        isPresented: Bool,
        onDismiss: @escaping () -> Void,
        appModel: AppModel,
        dataService: any SettingsDataService = UnavailableSettingsDataService()
    ) {
        self.isPresented = isPresented
        self.onDismiss = onDismiss
        self.appModel = appModel
        self.dataService = dataService
    }

    var body: some View {
        NavigationStack(path: $path) {
            SettingsPageContent(
                title: "Settings",
                leadingSymbol: "xmark",
                leadingAccessibilityLabel: "Close Settings",
                leadingAction: onDismiss,
                resetTrigger: isPresented
            ) {
                SettingsHomeContent(
                    appModel: appModel,
                    onShowSummary: { showDetail(.summary) },
                    onShowExport: { showDetail(.export) },
                    onShowRestore: { showDetail(.restore) },
                    onShowStatus: { showDetail(.status) },
                    onShowActivity: { showDetail(.activity) },
                    onShowAbout: { showDetail(.about) }
                )
            }
            .navigationDestination(for: SettingsDetailPage.self) { page in
                SettingsDetailLayer(
                    page: page,
                    dataService: dataService,
                    onBack: {
                        if !path.isEmpty {
                            path.removeLast()
                        }
                    }
                )
            }
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    private func showDetail(_ page: SettingsDetailPage) {
        path.append(page)
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
    let onBack: () -> Void

    var body: some View {
        SettingsPageContent(
            title: page.title,
            leadingSymbol: "chevron.left",
            leadingAccessibilityLabel: "Back to Settings",
            leadingAction: onBack
        ) {
            switch page {
            case .summary:
                SettingsSummaryContent()
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
}

private struct SettingsPageContent<Content: View>: View {
    let title: String
    let leadingSymbol: String
    let leadingAccessibilityLabel: String
    let leadingAction: () -> Void
    let resetTrigger: Bool?
    @State private var topEdgeHidden = true
    @State private var userHasInteractedWithScroll = false
    @ViewBuilder let content: Content

    init(
        title: String,
        leadingSymbol: String,
        leadingAccessibilityLabel: String,
        leadingAction: @escaping () -> Void,
        resetTrigger: Bool? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.leadingSymbol = leadingSymbol
        self.leadingAccessibilityLabel = leadingAccessibilityLabel
        self.leadingAction = leadingAction
        self.resetTrigger = resetTrigger
        self.content = content()
    }

    var body: some View {
        ZStack {
            Color(red: 0.965, green: 0.965, blue: 0.97)
                .ignoresSafeArea()

            ScrollView {
                content
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, 64)
            }
            .onScrollPhaseChange { _, newPhase, _ in
                guard newPhase == .interacting else { return }
                userHasInteractedWithScroll = true
            }
            .onScrollGeometryChange(for: CGFloat.self) { geometry in
                geometry.contentOffset.y + geometry.contentInsets.top
            } action: { _, normalizedOffset in
                guard userHasInteractedWithScroll else { return }
                topEdgeHidden = normalizedOffset <= 0.5
            }
            .scrollEdgeEffectStyle(.automatic, for: .top)
            .safeAreaBar(edge: .top, spacing: 0) {
                SettingsPageHeader(
                    title: title,
                    leadingSymbol: leadingSymbol,
                    leadingAccessibilityLabel: leadingAccessibilityLabel,
                    leadingAction: leadingAction
                )
            }
            .scrollEdgeEffectHidden(topEdgeHidden, for: .top)
        }
        .onChange(of: resetTrigger) { _, newValue in
            guard newValue == true else { return }
            topEdgeHidden = true
            userHasInteractedWithScroll = false
        }
    }
}

private struct SettingsPageHeader: View {
    let title: String
    let leadingSymbol: String
    let leadingAccessibilityLabel: String
    let leadingAction: () -> Void

    var body: some View {
        HStack {
            FloatingGlassButton(
                symbol: leadingSymbol,
                accessibilityLabel: leadingAccessibilityLabel,
                action: leadingAction
            )

            Spacer()

            Text(title)
                .font(.system(size: 18, weight: .semibold))

            Spacer()

            Color.clear
                .frame(width: 44, height: 44)
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 14)
    }
}

private struct SettingsHomeContent: View {
    @ObservedObject var appModel: AppModel
    let onShowSummary: () -> Void
    let onShowExport: () -> Void
    let onShowRestore: () -> Void
    let onShowStatus: () -> Void
    let onShowActivity: () -> Void
    let onShowAbout: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            SettingsSection(title: "Account") {
                SettingsValueRow(
                    title: "Email",
                    value: appModel.accountEmail ?? (appModel.isAuthenticated ? "Signed in" : "Not signed in"),
                    symbol: "envelope",
                    iconSize: 16
                )
                SettingsDivider(leadingInset: 52)
                SettingsValueRow(
                    title: "Sign-in provider",
                    value: "Auth0",
                    symbol: "person.badge.key"
                )
                SettingsDivider(leadingInset: 52)
                SettingsAuthRow(appModel: appModel)
            }

            SettingsSection(title: "Preference") {
                SettingsAppearanceMenuRow()
                SettingsDivider(leadingInset: 52)
                SettingsNotificationsRow()
            }

            SettingsSection(title: "Data") {
                SettingsNavigationRow(
                    title: "Summary",
                    symbol: "chart.bar",
                    iconSize: 16,
                    action: onShowSummary
                )
                SettingsDivider(leadingInset: 52)
                SettingsNavigationRow(
                    title: "Export",
                    symbol: "square.and.arrow.up",
                    action: onShowExport
                )
                SettingsDivider(leadingInset: 52)
                SettingsNavigationRow(
                    title: "Restore",
                    symbol: "square.and.arrow.down",
                    action: onShowRestore
                )
            }

            SettingsSection(title: "System") {
                SettingsNavigationRow(
                    title: "Status",
                    symbol: "network",
                    action: onShowStatus
                )
                SettingsDivider(leadingInset: 52)
                SettingsNavigationRow(
                    title: "Activity",
                    symbol: "clock.arrow.circlepath",
                    action: onShowActivity
                )
                SettingsDivider(leadingInset: 52)
                SettingsNavigationRow(
                    title: "About",
                    symbol: "info.circle",
                    action: onShowAbout
                )
            }
        }
    }
}

private struct SettingsSummaryContent: View {
    var body: some View {
        VStack(spacing: 0) {
            SettingsSummaryRow(title: "Memory")
            SettingsDivider(leadingInset: 16)
            SettingsSummaryRow(title: "Diary")
            SettingsDivider(leadingInset: 16)
            SettingsSummaryRow(title: "Task")
            SettingsDivider(leadingInset: 16)
            SettingsSummaryRow(title: "Todo")
            SettingsDivider(leadingInset: 16)
            SettingsSummaryRow(title: "Shared Paper")
        }
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 23, style: .continuous))
    }
}

private struct SettingsSummaryRow: View {
    let title: String

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 17, weight: .medium))

            Spacer()

            Text("Loading…")
                .font(.system(size: 17, weight: .regular))
                .foregroundStyle(.secondary)
        }
        .frame(height: 55)
        .padding(.horizontal, 16)
    }
}

struct SettingsSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.secondary)
                .padding(.leading, 13)

            VStack(spacing: 0) {
                content
            }
            .background(Color.white)
            .clipShape(
                RoundedRectangle(
                    cornerRadius: 23,
                    style: .continuous
                )
            )
        }
    }
}

private struct SettingsValueRow: View {
    let title: String
    let value: String
    let symbol: String
    var iconSize: CGFloat = 20

    var body: some View {
        HStack(spacing: 16) {
            SettingsRowIcon(symbol: symbol, size: iconSize)

            Text(title)
                .font(.system(size: 17, weight: .medium))

            Spacer()

            Text(value)
                .font(.system(size: 17, weight: .regular))
                .foregroundStyle(.secondary)
        }
        .frame(height: 55)
        .padding(.horizontal, 16)
    }
}

private struct SettingsTextRow: View {
    let title: String
    let symbol: String
    var iconSize: CGFloat = 20

    var body: some View {
        Button {
        } label: {
            HStack(spacing: 16) {
                SettingsRowIcon(symbol: symbol, size: iconSize)

                Text(title)
                    .font(.system(size: 17, weight: .medium))

                Spacer()
            }
            .frame(height: 55)
            .padding(.horizontal, 16)
        }
        .buttonStyle(.plain)
    }
}

private struct SettingsAuthRow: View {
    @ObservedObject var appModel: AppModel
    @State private var alert: AuthAlert?

    var body: some View {
        Button {
            if appModel.isAuthenticated {
                alert = .confirmation
            } else {
                Task {
                    await signIn()
                }
            }
        } label: {
            HStack(spacing: 16) {
                SettingsRowIcon(
                    symbol: appModel.isAuthenticated
                        ? "rectangle.portrait.and.arrow.right"
                        : "rectangle.portrait.and.arrow.forward",
                    size: 17
                )

                Text(appModel.isAuthenticated ? "Sign out" : "Sign in")
                    .font(.system(size: 17, weight: .medium))

                Spacer()
            }
            .frame(height: 55)
            .padding(.horizontal, 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .alert(item: $alert) { alert in
            switch alert {
            case .confirmation:
                Alert(
                    title: Text("Sign Out?"),
                    primaryButton: .destructive(Text("Sign Out")) {
                        Task {
                            await signOut()
                        }
                    },
                    secondaryButton: .cancel(Text("Cancel"))
                )
            case .error(let message):
                Alert(
                    title: Text("Authentication unavailable"),
                    message: Text(message),
                    dismissButton: .cancel(Text("OK"))
                )
            }
        }
    }

    @MainActor
    private func signIn() async {
        do {
            try await appModel.signIn()
        } catch {
            alert = .error(error.localizedDescription)
        }
    }

    @MainActor
    private func signOut() async {
        do {
            try await appModel.signOut()
        } catch {
            alert = .error(error.localizedDescription)
        }
    }
}

private enum AuthAlert: Identifiable {
    case confirmation
    case error(String)

    var id: String {
        switch self {
        case .confirmation:
            "confirmation"
        case .error(let message):
            "error-\(message)"
        }
    }
}

private struct SettingsNavigationRow: View {
    let title: String
    let symbol: String
    var iconSize: CGFloat = 20
    var action: () -> Void = {}

    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                SettingsRowIcon(symbol: symbol, size: iconSize)

                Text(title)
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
    }
}

private struct SettingsAppearanceMenuRow: View {
    @AppStorage("appearanceMode") private var appearanceModeRawValue = AppearanceMode.system.rawValue

    var body: some View {
        HStack(spacing: 16) {
            SettingsRowIcon(symbol: "circle.lefthalf.filled")

            Text("Appearance")
                .font(.system(size: 17, weight: .medium))

            Spacer()

            Color.clear
                .frame(width: 44, height: 55)
        }
        .frame(height: 55)
        .padding(.horizontal, 16)
        .contentShape(Rectangle())
        .overlay {
            SettingsAppearanceMenuHitArea(selection: $appearanceModeRawValue)
        }
    }
}

private struct SettingsAppearanceMenuHitArea: UIViewRepresentable {
    @Binding var selection: String

    func makeUIView(context: Context) -> AppearanceMenuHitContainer {
        let container = AppearanceMenuHitContainer()
        let button = container.menuButton
        var configuration = UIButton.Configuration.plain()
        configuration.image = UIImage(systemName: "chevron.up.chevron.down")
        configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(
            pointSize: 14,
            weight: .semibold
        )
        configuration.baseForegroundColor = .secondaryLabel
        button.configuration = configuration
        button.showsMenuAsPrimaryAction = true
        updateMenu(for: button)
        return container
    }

    func updateUIView(_ uiView: AppearanceMenuHitContainer, context: Context) {
        updateMenu(for: uiView.menuButton)
    }

    private func updateMenu(for button: UIButton) {
        button.menu = UIMenu(
            options: .displayInline,
            children: AppearanceMode.allCases.map { mode in
                UIAction(
                    title: mode.title,
                    state: selection == mode.rawValue ? .on : .off
                ) { _ in
                    selection = mode.rawValue
                }
            }
        )
    }
}

private final class AppearanceMenuHitContainer: UIView {
    let menuButton = ExpandedHitMenuButton(type: .system)

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        menuButton.hitContainer = self
        addSubview(menuButton)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        menuButton.frame = CGRect(
            x: bounds.maxX - 60,
            y: 0,
            width: 44,
            height: bounds.height
        )
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard bounds.contains(point), !isHidden, alpha > 0 else { return nil }
        return menuButton
    }
}

private final class ExpandedHitMenuButton: UIButton {
    weak var hitContainer: UIView?

    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        guard let hitContainer else {
            return super.point(inside: point, with: event)
        }
        let pointInContainer = convert(point, to: hitContainer)
        return hitContainer.bounds.contains(pointInContainer)
    }
}

private struct SettingsNotificationsRow: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var authorizationStatus: UNAuthorizationStatus = .notDetermined

    private var statusTitle: String {
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

    var body: some View {
        Button {
            Task {
                await handleTap()
            }
        } label: {
            HStack(spacing: 16) {
                SettingsRowIcon(symbol: "bell", size: 18)

                Text("Notifications")
                    .font(.system(size: 17, weight: .medium))

                Spacer()

                Text(statusTitle)
                    .font(.system(size: 17, weight: .regular))
                    .foregroundStyle(.secondary)

                Image(systemName: "chevron.right")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .frame(height: 55)
            .padding(.horizontal, 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .task {
            await refreshAuthorizationStatus()
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            Task {
                await refreshAuthorizationStatus()
            }
        }
    }

    private func handleTap() async {
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

private struct SettingsRowIcon: View {
    let symbol: String
    var size: CGFloat = 18

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size, weight: .medium))
            .frame(width: 20, height: 20, alignment: .center)
    }
}

struct SettingsDivider: View {
    var leadingInset: CGFloat = 16

    var body: some View {
        Divider()
            .padding(.leading, leadingInset)
            .padding(.trailing, 16)
    }
}
