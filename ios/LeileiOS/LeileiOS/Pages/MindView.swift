import SwiftUI

struct MindView: View {
    @State private var addPresented = false

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Persistent Subject State")
                        .font(.system(
                            size: 18,
                            weight: .medium
                        ))

                    Text(
                        "Authoritative Mind data is not connected yet."
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }

            Section("Kinds") {
                ForEach(MindKind.allCases) { kind in
                    NavigationLink {
                        MindKindDetailPlaceholder(
                            kind: kind
                        )
                    } label: {
                        HStack(spacing: 12) {
                            Image(
                                systemName:
                                    kind.systemImage
                            )
                            .font(.system(
                                size: 16,
                                weight: .regular
                            ))
                            .frame(width: 22)
                            .foregroundStyle(.secondary)

                            VStack(
                                alignment: .leading,
                                spacing: 3
                            ) {
                                Text(kind.title)
                                    .foregroundStyle(.primary)

                                Text(kind.subtitle)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }

                            Spacer(minLength: 8)

                            Text("Unavailable")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Section("Source") {
                LabeledContent(
                    "Runtime",
                    value: "Unavailable"
                )
                LabeledContent(
                    "Manual",
                    value: "Unavailable"
                )
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color(.systemBackground))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    addPresented = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add Mind")
            }
        }
        .sheet(isPresented: $addPresented) {
            MindManualEntryPlaceholder()
        }
    }
}

private enum MindKind:
    String,
    CaseIterable,
    Identifiable {
    case feel
    case memory
    case drive
    case thought
    case curiosity
    case topic

    var id: String { rawValue }

    var title: String {
        rawValue.capitalized
    }

    var subtitle: String {
        switch self {
        case .feel:
            return "Affective state"
        case .memory:
            return "Long-term remembered state"
        case .drive:
            return "Ongoing pressure and direction"
        case .thought:
            return "Persistent thought"
        case .curiosity:
            return "Open question or curiosity"
        case .topic:
            return "Derived active topic"
        }
    }

    var systemImage: String {
        switch self {
        case .feel:
            return "heart"
        case .memory:
            return "clock.arrow.circlepath"
        case .drive:
            return "arrow.up.forward"
        case .thought:
            return "bubble.left"
        case .curiosity:
            return "questionmark.circle"
        case .topic:
            return "tag"
        }
    }
}

private struct MindKindDetailPlaceholder: View {
    let kind: MindKind

    var body: some View {
        List {
            Section("State") {
                LabeledContent("Kind", value: kind.title)
                LabeledContent("Lifecycle", value: "—")
                LabeledContent("Strength", value: "—")
            }

            Section("Source") {
                LabeledContent("Type", value: "—")
                LabeledContent("Runtime / Manual", value: "—")
            }

            Section("Time") {
                LabeledContent("Occurred", value: "—")
                LabeledContent("Created", value: "—")
                LabeledContent("Updated", value: "—")
            }

            Section("Provenance") {
                Text("Unavailable")
                    .foregroundStyle(.secondary)
            }

            Section {
                Button(
                    "Delete",
                    role: .destructive
                ) {
                }
                .disabled(true)
            } footer: {
                Text(
                    "Delete becomes available after the authoritative Mind mutation contract is connected."
                )
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color(.systemBackground))
        .navigationTitle(kind.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct MindManualEntryPlaceholder: View {
    @Environment(\.dismiss) private var dismiss

    @State private var kind: MindKind = .memory
    @State private var text = ""
    @State private var hasOccurredAt = false
    @State private var occurredAt = Date.now

    var body: some View {
        NavigationStack {
            Form {
                Section("Mind") {
                    Picker("Kind", selection: $kind) {
                        ForEach(MindKind.allCases) { kind in
                            Text(kind.title)
                                .tag(kind)
                        }
                    }

                    TextEditor(text: $text)
                        .frame(minHeight: 120)
                }

                Section("Time") {
                    Toggle(
                        "Occurred at",
                        isOn: $hasOccurredAt
                    )

                    if hasOccurredAt {
                        DatePicker(
                            "Date",
                            selection: $occurredAt
                        )
                    }
                }

                Section {
                    LabeledContent(
                        "Source",
                        value: "Manual"
                    )
                    LabeledContent(
                        "Authority",
                        value: "Unavailable"
                    )
                } footer: {
                    Text(
                        "Manual Mind writes require the main authoritative contract. This form does not persist data yet."
                    )
                }
            }
            .navigationTitle("Add Mind")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(
                    placement: .cancellationAction
                ) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(
                    placement: .confirmationAction
                ) {
                    Button("Add") {
                    }
                    .disabled(true)
                }
            }
        }
    }
}
