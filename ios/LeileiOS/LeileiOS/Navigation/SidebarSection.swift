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
                            .font(.system(size: 16, weight: .regular))
                            .frame(width: 18, alignment: .center)

                        Text(page.rawValue)
                            .font(.system(size: 17.5, weight: .regular))

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
                                .padding(.trailing, 3)
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
        case .projects:
            return "folder"
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
