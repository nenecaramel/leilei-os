import SwiftUI

@main
struct LeileiOSApp: App {
    @StateObject private var appModel = AppModel()
    @AppStorage("appearanceMode") private var appearanceModeRawValue = AppearanceMode.system.rawValue

    private var appearanceMode: AppearanceMode {
        AppearanceMode(rawValue: appearanceModeRawValue) ?? .system
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appModel)
                .preferredColorScheme(appearanceMode.colorScheme)
                .task {
                    await appModel.restoreAuthState()
                }
        }
    }
}
