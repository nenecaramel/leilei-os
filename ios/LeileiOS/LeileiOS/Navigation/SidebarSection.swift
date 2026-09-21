import SwiftUI

struct SidebarSection: View {
    let title: String
    let pages: [AppPage]

    @Binding var selectedPage: AppPage

    let onSelect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 10)

            ForEach(pages) { page in
                Button {
                    selectedPage = page
                    onSelect()
                } label: {
                    HStack {
                        Text(page.rawValue)
                            .font(.body)
                            .fontWeight(selectedPage == page ? .semibold : .regular)

                        Spacer()
                    }
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 12)
                    .frame(height: 44)
                    .background {
                        if selectedPage == page {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(.primary.opacity(0.07))
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }
}
