import SwiftUI

struct SettingsAboutContent: View {
    private let bundle = Bundle.main

    private var version: String {
        bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unavailable"
    }

    private var build: String {
        bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "Unavailable"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            SettingsDetailCard {
                SettingsDetailValueRow(title: "Leilei OS", value: "Leilei OS")
                SettingsDivider()
                SettingsDetailValueRow(title: "Version", value: version)
                SettingsDivider()
                SettingsDetailValueRow(title: "Build", value: build)
                SettingsDivider()
                SettingsDetailValueRow(title: "Commit", value: "Unavailable")
                SettingsDivider()
                SettingsDetailValueRow(title: "Environment", value: "Unavailable")
            }
        }
    }
}
