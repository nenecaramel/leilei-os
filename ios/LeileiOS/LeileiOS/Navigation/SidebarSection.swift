import SwiftUI

struct SidebarSection: View {
    let title: String?
    let pages: [AppPage]

    @Binding var selectedPage: AppPage

    let onSelect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: SidebarLayout.rowSpacing) {
            if let title {
                Text(title)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, SidebarLayout.sectionLabelHorizontalInset)
                    .offset(y: SidebarLayout.rowTextPaintOffset.height)
            }

            ForEach(pages) { page in
                Button {
                    selectedPage = page
                    onSelect()
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: page.sidebarSystemImage)
                            .font(.system(size: 16, weight: .regular))
                            .frame(width: 18, alignment: .center)

                        Text(page.rawValue)
                            .font(.system(size: 17.5, weight: .regular))

                        Spacer()
                    }
                    .offset(SidebarLayout.rowTextPaintOffset)
                    .foregroundStyle(.primary)
                    .padding(.horizontal, SidebarLayout.rowHorizontalInset)
                    .frame(maxWidth: .infinity, minHeight: SidebarLayout.rowMinimumHeight, alignment: .leading)
                    .contentShape(Rectangle())
                    .background {
                        if selectedPage == page {
                            SidebarSelectionBackground()
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private extension AppPage {
    var sidebarSystemImage: String {
        switch self {
        case .diary:
            return "book.closed"
        case .daySpace:
            return "calendar"
        case .mind:
            return "circle.dotted.circle"
        case .universe:
            return "sparkles"
        default:
            return "circle"
        }
    }
}
