import Foundation
import SwiftUI
import UniformTypeIdentifiers

extension UniverseNodeSheet {
    func detail(
        _ node: UniverseNode
    ) -> some View {
        ScrollView {
            VStack(
                alignment: .leading,
                spacing: 24
            ) {
                VStack(
                    alignment: .leading,
                    spacing: 9
                ) {
                    Text(
                        UniverseNodeOptions.typeLabel(
                            node.type
                        )
                    )
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)

                    Text(node.title)
                        .font(
                            .system(
                                size: 31,
                                weight: .semibold
                            )
                        )

                    if !node.summary.isEmpty {
                        Text(node.summary)
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }

                    Text(
                        "Created \(formattedDate(node.createdAt)) · Updated \(formattedDate(node.updatedAt))"
                    )
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                }

                if !node.content.isEmpty {
                    Text(node.content)
                        .font(.body)
                        .textSelection(.enabled)
                        .frame(
                            maxWidth: .infinity,
                            alignment: .leading
                        )
                }

                detailMetadata(node)

                HStack(spacing: 6) {
                    Text("Connections")
                        .foregroundStyle(.secondary)

                    Text("\(connections.count)")
                        .fontWeight(.semibold)
                }
                .font(.subheadline)

                if !connections.isEmpty {
                    connectionsSection
                }

                if !sources.isEmpty {
                    provenanceSection
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 28)
            .frame(
                maxWidth: 720,
                alignment: .leading
            )
            .frame(maxWidth: .infinity)
        }
    }

    private func detailMetadata(
        _ node: UniverseNode
    ) -> some View {
        VStack(
            alignment: .leading,
            spacing: 12
        ) {
            HStack(
                spacing: 8
            ) {
                metadataPill(
                    UniverseNodeOptions.typeLabel(
                        node.type
                    )
                )
                metadataPill(
                    UniverseNodeOptions.importanceLabel(node.importance ?? "normal")
                )
            }

            if !node.tags.isEmpty {
                FlowLayout(
                    spacing: 8
                ) {
                    ForEach(
                        node.tags,
                        id: \.self
                    ) { tag in
                        Text("# \(tag)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .padding(
                                .horizontal,
                                10
                            )
                            .padding(
                                .vertical,
                                6
                            )
                            .background(
                                UniversePalette.surface,
                                in: Capsule()
                            )
                    }
                }
            }

            if !node.galaxies.isEmpty {
                VStack(
                    alignment: .leading,
                    spacing: 8
                ) {
                    Text("Galaxies")
                        .font(
                            .subheadline.weight(
                                .medium
                            )
                        )
                        .foregroundStyle(.secondary)

                    ForEach(
                        node.galaxies
                    ) { membership in
                        let galaxy =
                            galaxies.first {
                                $0.id == membership.id
                            }

                        HStack(spacing: 8) {
                            Circle()
                                .fill(
                                    UniversePalette.color(
                                        hex: galaxy?.color
                                    )
                                )
                                .frame(
                                    width: 8,
                                    height: 8
                                )

                            Text(
                                galaxy?.title
                                    ?? membership.id
                            )

                            Spacer()

                            Text(
                                formattedMembershipWeight(
                                    membership.weight
                                )
                            )
                            .foregroundStyle(.secondary)
                        }
                        .font(.subheadline)
                    }
                }
            }
        }
    }

    private var connectionsSection: some View {
        VStack(
            alignment: .leading,
            spacing: 8
        ) {
            Text("Connections")
                .font(.headline)

            ForEach(connections) { connection in
                HStack(spacing: 8) {
                    Button {
                        onOpenRelatedNode(
                            connection.node.id
                        )
                    } label: {
                        VStack(
                            alignment: .leading,
                            spacing: 2
                        ) {
                            Text(
                                connection.node.title
                            )
                            .foregroundStyle(.primary)

                            Text(
                                connection.relation
                                    .relationType.label
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        .frame(
                            maxWidth: .infinity,
                            alignment: .leading
                        )
                    }
                    .buttonStyle(.plain)

                    Menu {
                        Button(
                            role: .destructive
                        ) {
                            confirmation = .removeConnection(connection.relation)
                        } label: {
                            Label(
                                "Remove Connection",
                                systemImage:
                                    "link.badge.minus"
                            )
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .frame(
                                width: 32,
                                height: 32
                            )
                    }
                    .accessibilityLabel("Connection actions")
                }
                .padding(.vertical, 7)

                Divider()
                    .overlay(
                        UniversePalette.border
                    )
            }
        }
    }

    private var provenanceSection: some View {
        VStack(
            alignment: .leading,
            spacing: 10
        ) {
            Text("Source Diaries")
                .font(.headline)

            ForEach(
                sources.sorted {
                    if $0.date != $1.date {
                        return $0.date < $1.date
                    }
                    return $0.diaryId < $1.diaryId
                }
            ) { source in
                Button {
                    diarySourceSelection = source
                } label: {
                    HStack(spacing: 12) {
                        VStack(spacing: 0) {
                            Circle()
                                .fill(
                                    Color.secondary.opacity(
                                        0.75
                                    )
                                )
                                .frame(
                                    width: 6,
                                    height: 6
                                )

                            Rectangle()
                                .fill(
                                    Color.secondary.opacity(
                                        0.22
                                    )
                                )
                                .frame(
                                    width: 1,
                                    height: 32
                                )
                        }

                        VStack(
                            alignment: .leading,
                            spacing: 2
                        ) {
                            Text(
                                sourceDate(
                                    source.date
                                )
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)

                            HStack(spacing: 6) {
                                Text(source.title)
                                    .lineLimit(1)

                                if source.status
                                    == "archived" {
                                    Text("Archived")
                                        .font(.caption2)
                                        .foregroundStyle(
                                            .secondary
                                        )
                                }
                            }
                        }

                        Spacer()
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    func metadataPill(
        _ text: String
    ) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding(
                .horizontal,
                10
            )
            .padding(
                .vertical,
                6
            )
            .background(
                UniversePalette.surface,
                in: Capsule()
            )
    }
}
