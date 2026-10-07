import SwiftUI
import Foundation

struct MindView: View {
    @EnvironmentObject private var appModel: AppModel
    @State private var addPresented = false

    var body: some View {
        List {
            Section {
                ForEach(MindProductKind.allCases) { kind in
                    NavigationLink {
                        MindKindDetailView(kind: kind)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: kind.systemImage)
                                .font(.system(
                                    size: 16,
                                    weight: .regular
                                ))
                                .frame(width: 22)
                                .foregroundStyle(.secondary)

                            Text(kind.displayName)
                                .foregroundStyle(.primary)

                            Spacer(minLength: 8)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
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
            MindManualEntrySheet()
                .environmentObject(appModel)
        }
    }
}

private extension MindProductKind {
    var systemImage: String {
        switch self {
        case .memory:
            return "clock.arrow.circlepath"
        }
    }
}
