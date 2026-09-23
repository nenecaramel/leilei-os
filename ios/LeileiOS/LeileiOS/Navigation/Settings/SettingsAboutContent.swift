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
            Section {
                LabeledContent("Leilei OS", value: "Leilei OS")
                LabeledContent("Version", value: version)
                LabeledContent("Build", value: build)
                LabeledContent("Commit", value: "Unavailable")
                LabeledContent("Environment", value: "Unavailable")
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Color.settingsBackground)
    }
}
