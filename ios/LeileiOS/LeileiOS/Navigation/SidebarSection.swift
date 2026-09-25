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
                    HStack(spacing: 10) {
                        Image(systemName: page.sidebarSystemImage)
                            .font(.system(size: 16, weight: .medium))
                            .frame(width: 18, alignment: .leading)

                        Text(page.rawValue)
                            .font(.system(size: 17.5, weight: .medium))

                        Spacer()
                    }
                    .offset(x: textLeadingOffset, y: 2)
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 12)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                    .background {
                        if selectedPage == page {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(.primary.opacity(0.05))
                                .padding(.leading, selectedBackgroundLeadingOffset)
                                .padding(.trailing, -2)
                                .offset(y: 2)
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
        case .home:
            return "house"
        case .diary:
            return "book.closed"
        case .daySpace:
            return "calendar"
        case .universe:
            return "sparkles"
        case .sentinel:
            return "shield"
        default:
            return "circle"
        }
    }
}
