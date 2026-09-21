import SwiftUI

struct SidebarView: View {
    @Binding var selectedPage: AppPage
    let onSelect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    Text("Leilei OS")
                        .font(.system(size: 20, weight: .semibold))
                        .padding(.top, 18)

                    SidebarSection(
                        title: "Core",
                        pages: [
                            .home, .chat, .memory, .diary, .task, .daySpace,
                            .sharedPaper, .conversations, .universe, .sentinel
                        ],
                        selectedPage: $selectedPage,
                        onSelect: onSelect
                    )

                    SidebarSection(
                        title: "Utilities",
                        pages: [.globalSearch],
                        selectedPage: $selectedPage,
                        onSelect: onSelect
                    )
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 24)
            }

            Button {
                selectedPage = .system
                onSelect()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "gearshape")
                        .font(.system(size: 17, weight: .medium))

                    Text("System")
                        .font(.body.weight(.medium))
                }
                .foregroundStyle(.primary)
                .padding(.horizontal, 14)
                .frame(height: 46)
                .background(
                    Capsule()
                        .fill(Color(.secondarySystemFill))
                )
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 22)
            .padding(.bottom, 18)
        }
    }
}
