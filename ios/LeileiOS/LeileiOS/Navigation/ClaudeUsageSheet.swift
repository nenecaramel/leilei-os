import SwiftUI

struct ClaudeUsageSheet: View {
    @Environment(\.dismiss) private var dismiss

    let api: LeileiAPIClient

    @State private var snapshot: SystemClaudeUsageSnapshot?
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Form {
                Section("Usage") {
                    if let snapshot,
                       !snapshot.windows.isEmpty {
                        ForEach(snapshot.windows) { window in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(windowTitle(window.kind))
                                    Spacer()
                                    Text(utilizationLabel(window.utilization))
                                        .foregroundStyle(.secondary)
                                }

                                if let utilization = normalizedProgress(
                                    window.utilization
                                ) {
                                    ProgressView(value: utilization)
                                }

                                if let resetsAt = formattedDate(
                                    window.resetsAt
                                ) {
                                    LabeledContent(
                                        "Resets",
                                        value: resetsAt
                                    )
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text("Usage")
                                Spacer()
                                Text("—")
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                            }

                            ProgressView(value: 0)
                                .progressViewStyle(.linear)
                        }
                        .padding(.vertical, 4)
                    }
                }

                if let overage = snapshot?.overage {
                    Section("Overage") {
                        if let status = overage.status {
                            LabeledContent("Status", value: status)
                        }
                        if let isUsing = overage.isUsing {
                            LabeledContent(
                                "Using overage",
                                value: isUsing ? "Yes" : "No"
                            )
                        }
                        if let resetsAt = formattedDate(
                            overage.resetsAt
                        ) {
                            LabeledContent(
                                "Resets",
                                value: resetsAt
                            )
                        }
                        if let reason = overage.disabledReason {
                            LabeledContent(
                                "Unavailable reason",
                                value: reason
                            )
                        }
                    }
                }

                Section {
                    LabeledContent(
                        "Last observed",
                        value:
                            formattedDate(snapshot?.observedAt)
                            ?? snapshot?.observedAt
                            ?? "—"
                    )
                } footer: {
                    Text(
                        "Updated from Claude runtime events. Opening this sheet does not consume usage."
                    )
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Color.settingsBackground)
            .navigationTitle("Claude Usage")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Task {
                            await load()
                        }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(isLoading)
                    .accessibilityLabel("Refresh Claude usage")
                }
            }
            .task {
                await load()
            }
        }
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }

        do {
            snapshot = try await api.systemClaudeUsage()
        } catch {
            // Usage is auxiliary. Keep the existing snapshot when refresh
            // fails, or leave the placeholder state in place on first load.
        }
    }

    private func windowTitle(_ kind: String) -> String {
        switch kind {
        case "five_hour", "fiveHour", "5h":
            return "5-hour"
        case "seven_day", "sevenDay", "7d":
            return "7-day"
        case "seven_day_opus":
            return "7-day · Opus"
        case "seven_day_sonnet":
            return "7-day · Sonnet"
        default:
            return kind
                .replacingOccurrences(of: "_", with: " ")
                .replacingOccurrences(of: "-", with: " ")
                .capitalized
        }
    }

    private func utilizationLabel(_ value: Double?) -> String {
        guard let value else { return "—" }
        let percent = value <= 1.000_001 ? value * 100 : value
        return percent.formatted(
            .number.precision(.fractionLength(0...1))
        ) + "%"
    }

    private func normalizedProgress(_ value: Double?) -> Double? {
        guard let value, value >= 0 else { return nil }
        let normalized = value <= 1.000_001
            ? value
            : value / 100
        return min(max(normalized, 0), 1)
    }

    private func formattedDate(_ value: String?) -> String? {
        guard let value else { return nil }

        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds
        ]
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]

        guard let date =
            fractional.date(from: value)
            ?? standard.date(from: value) else {
            return nil
        }

        return date.formatted(
            date: .abbreviated,
            time: .shortened
        )
    }
}
