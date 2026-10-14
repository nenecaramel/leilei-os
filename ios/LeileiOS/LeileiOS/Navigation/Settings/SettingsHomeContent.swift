import SwiftUI
import UIKit
import PhotosUI
import UserNotifications

struct SettingsHomeContent: View {
    @ObservedObject var appModel: AppModel

    @AppStorage("appearanceMode") private var appearanceModeRawValue = AppearanceMode.system.rawValue
    @AppStorage(ChatTheme.storageKey) private var chatThemeRawValue =
        ChatTheme.original.rawValue
    @AppStorage(IMessageWallpaper.revisionKey) private var wallpaperRevision = ""
    @State private var wallpaperSelection: PhotosPickerItem?
    @State private var hasWallpaper = false
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

                Picker(selection: $chatThemeRawValue) {
                    ForEach(ChatTheme.allCases) { theme in
                        Text(theme.title)
                            .tag(theme.rawValue)
                    }
                } label: {
                    Label("Chat Style", systemImage: "bubble.left.and.bubble.right")
                }
                .pickerStyle(.menu)

                if chatThemeRawValue == ChatTheme.iMessage.rawValue {
                    LabeledContent("Chat Background") {
                        Text(hasWallpaper ? "Custom" : "Default")
                            .foregroundStyle(.secondary)
                    }

                    PhotosPicker(selection: $wallpaperSelection, matching: .images) {
                        Label(
                            hasWallpaper ? "Change Chat Background" : "Choose Chat Background",
                            systemImage: "photo.on.rectangle.angled"
                        )
                    }

                    if hasWallpaper {
                        Button(role: .destructive) {
                            do {
                                try IMessageWallpaper.remove()
                                wallpaperRevision = UUID().uuidString
                            } catch {
                                authErrorMessage = error.localizedDescription
                            }
                        } label: {
                            Label("Restore Default Background", systemImage: "arrow.uturn.backward")
                        }
                    }
                }

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
        .task(id: wallpaperRevision) {
            hasWallpaper = IMessageWallpaper.load() != nil
        }
        .onChange(of: wallpaperSelection) { _, item in
            guard let item else { return }
            Task { @MainActor in
                defer { wallpaperSelection = nil }
                do {
                    guard let data = try await item.loadTransferable(type: Data.self),
                          let image = UIImage(data: data) else {
                        throw IMessageWallpaper.WallpaperError.invalidImage
                    }
                    try IMessageWallpaper.save(image)
                    wallpaperRevision = UUID().uuidString
                } catch {
                    authErrorMessage = error.localizedDescription
                }
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            Task {
                await refreshAuthorizationStatus()
            }
        }
        .appConfirmationAlert(
            title: "Sign out?",
            message: "You will need to sign in again to access your account.",
            actionTitle: "Sign Out",
            actionRole: .destructive,
            isPresented: $showingSignOutConfirmation
        ) {
            Task { await signOut() }
        }
        .appFailureAlert(
            message: authErrorMessage ?? "Authentication could not be completed.",
            isPresented: Binding(
                get: { authErrorMessage != nil },
                set: { if !$0 { authErrorMessage = nil } }
            )
        )
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
