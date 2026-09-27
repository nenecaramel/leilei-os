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
        Form {
            Section("About") {
                LabeledContent("Version", value: version)
                LabeledContent("Build", value: build)
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Color.settingsBackground)
    }
}
