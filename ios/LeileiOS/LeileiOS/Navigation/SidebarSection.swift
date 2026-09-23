import SwiftUI

struct SidebarSection: View {
    let title: String?
    let pages: [AppPage]

    @Binding var selectedPage: AppPage

    let textLeadingOffset: CGFloat
    let selectedBackgroundLeadingOffset: CGFloat
    let onSelect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title {
                Text(title)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 10)
                    .offset(y: 2)
            }

            ForEach(pages) { page in
                Button {
                    selectedPage = page
                    onSelect()
                } label: {
                    HStack {
                        Text(page.rawValue)
                            .font(.body.weight(.medium))
                            .offset(x: textLeadingOffset, y: 2)

                        Spacer()
                    }
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 12)
                    .frame(height: 44)
                    .background {
                        if selectedPage == page {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(.primary.opacity(0.05))
                                .padding(.leading, selectedBackgroundLeadingOffset)
                                .padding(.trailing, -2)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }
}
