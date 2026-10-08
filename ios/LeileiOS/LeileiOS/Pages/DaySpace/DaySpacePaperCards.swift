import SwiftUI
import UIKit

struct DaySpaceStage: View {
    let dateKey: String
    let papers: [DaySpacePaperSelection]
    let onSelect: (DaySpacePaperSelection) -> Void

    @State private var stageWidth: CGFloat = 345

    var body: some View {
        let layout = DaySpaceLayout.layout(
            dateKey: dateKey,
            papers: papers,
            rawStageWidth: stageWidth
        )

        ZStack(alignment: .topLeading) {
            ForEach(papers) { paper in
                if let item = layout.itemsByID[paper.id] {
                    Button {
                        onSelect(paper)
                    } label: {
                        DaySpacePaperCard(
                            paper: paper,
                            size: item.size
                        )
                    }
                    .buttonStyle(.plain)
                    .frame(
                        width: item.width,
                        height: item.height
                    )
                    .rotationEffect(.degrees(item.rotation))
                    .position(
                        x: item.left + item.width / 2,
                        y: item.top + item.height / 2
                    )
                    .zIndex(Double(item.zIndex))
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: layout.stageHeight)
        .background {
            GeometryReader { proxy in
                Color.clear
                    .onAppear {
                        stageWidth = max(280, proxy.size.width)
                    }
                    .onChange(of: proxy.size.width) { _, width in
                        stageWidth = max(280, width)
                    }
            }
        }
    }
}

private struct DaySpacePaperCard: View {
    let paper: DaySpacePaperSelection
    let size: DaySpacePaperSize

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            VStack(alignment: .leading, spacing: 0) {
                switch paper {
                case .todo(let todo):
                    DaySpaceTodoPreview(
                        paper: todo,
                        size: size
                    )

                case .memory(_, let items):
                    DaySpaceProsePreview(title: nil, paragraphs: items.map { $0.text ?? "" }, size: size, multiple: true)
                case .diary(let diary):
                    DaySpaceDiaryPreview(
                        diary: diary,
                        size: size
                    )
                }

                Spacer(minLength: 0)
            }
            .frame(
                maxWidth: .infinity,
                maxHeight: .infinity,
                alignment: .topLeading
            )
            .padding(.horizontal, 14)
            .padding(.top, 15)
            .padding(.bottom, 24)

            Text(paper.authorLabel)
                .font(.system(size: 13, design: .serif).italic())
                .foregroundStyle(.secondary)
                .padding(.trailing, 10)
                .padding(.bottom, 7)
        }
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(Color(.systemBackground))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(Color.primary.opacity(0.105), lineWidth: 1)
        )
        .shadow(
            color: .black.opacity(0.055),
            radius: 11,
            y: 8
        )
        .contentShape(Rectangle())
    }
}

private struct DaySpaceTodoPreview: View {
    let paper: DaySpaceTodoPaper
    let size: DaySpacePaperSize

    private var previewLimit: Int {
        switch size {
        case .small:
            return 2
        case .medium:
            return 3
        case .large:
            return 4
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(paper.entries.prefix(previewLimit)) { entry in
                HStack(alignment: .top, spacing: 6) {
                    DaySpaceTodoMark(kind: entry.kind)
                        .frame(width: 8, height: 8)
                        .padding(.top, 3)

                    Text(entry.text)
                        .font(.system(size: 10.5))
                        .foregroundStyle(
                            entry.kind == .completed
                                ? Color.secondary.opacity(0.6)
                                : Color.secondary
                        )
                        .strikethrough(entry.kind == .completed)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .frame(
                            maxWidth: .infinity,
                            alignment: .leading
                        )
                }
            }

            if paper.entries.count > previewLimit {
                Text("...")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
            }
        }
    }
}

private struct DaySpaceTodoMark: View {
    let kind: DaySpaceTodoEntryKind

    var body: some View {
        switch kind {
        case .record:
            Circle()
                .fill(Color.secondary)
                .frame(width: 5, height: 5)

        case .pending:
            Circle()
                .stroke(Color.secondary, lineWidth: 1)
                .frame(width: 5, height: 5)

        case .completed:
            Circle()
                .fill(Color.secondary)
                .frame(width: 5, height: 5)
        }
    }
}

private struct DaySpaceDiaryPreview: View {
    let diary: DaySpaceDiary
    let size: DaySpacePaperSize
    var body: some View {
        DaySpaceProsePreview(title: diary.title, paragraphs: [diary.content], size: size, multiple: false)
    }
}

private struct DaySpaceProsePreview: View {
    let title: String?
    let paragraphs: [String]
    let size: DaySpacePaperSize
    let multiple: Bool
    private var limit: Int {
        switch size { case .small: return 2; case .medium: return 3; case .large: return 4 }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title {
                Text(title).font(.system(size: 12, weight: .medium)).foregroundStyle(.primary)
                    .lineLimit(2).multilineTextAlignment(.leading)
            }
            ForEach(Array(paragraphs.prefix(multiple ? limit : 1).enumerated()), id: \.offset) { _, text in
                Text(text).font(.system(size: 10)).foregroundStyle(.secondary)
                    .lineSpacing(2.6).lineLimit(multiple ? 2 : limit + 1).multilineTextAlignment(.leading)
            }
            if multiple && paragraphs.count > limit {
                Text("...").font(.system(size: 11)).foregroundStyle(.tertiary)
            }
        }
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .clipped()
    }
}

struct DaySpacePaperRules: View {
    var body: some View {
        GeometryReader { proxy in
            Path { path in
                var y: CGFloat = 29.5

                while y < proxy.size.height {
                    path.move(
                        to: CGPoint(
                            x: 0,
                            y: y
                        )
                    )
                    path.addLine(
                        to: CGPoint(
                            x: proxy.size.width,
                            y: y
                        )
                    )
                    y += 30
                }
            }
            .stroke(
                Color.black.opacity(0.075),
                lineWidth: 1
            )
        }
        .allowsHitTesting(false)
    }
}
