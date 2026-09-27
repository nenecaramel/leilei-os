import SwiftUI

struct MindView: View {
    @State private var addPresented = false

    var body: some View {
        List {
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

                            Text(kind.title)
                                .foregroundStyle(.primary)

                            Spacer(minLength: 8)
                        }
                    }
                }
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
        AppStateSurface(title: "Nothing here")
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
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Color.settingsBackground)
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
