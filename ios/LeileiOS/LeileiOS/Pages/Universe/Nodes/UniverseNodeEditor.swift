import Foundation
import SwiftUI
import UniformTypeIdentifiers

extension UniverseNodeSheet {
    var editor: some View {
        ScrollView {
            VStack(
                alignment: .leading,
                spacing: 22
            ) {
                if let contextLine {
                    Text(contextLine)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                editorField(
                    title: "Title"
                ) {
                    TextField(
                        "Enter a title",
                        text: Binding(
                            get: {
                                draft.title
                            },
                            set: { value in
                                draft.title = String(
                                    value.prefix(60)
                                )
                            }
                        )
                    )
                    .textInputAutocapitalization(.sentences)
                }

                editorField(
                    title: "Summary (Optional)"
                ) {
                    TextField(
                        "Add a short summary",
                        text: $draft.summary,
                        axis: .vertical
                    )
                    .lineLimit(2...5)
                }

                editorField(
                    title: "Content"
                ) {
                    TextEditor(
                        text: $draft.content
                    )
                    .frame(minHeight: 150)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .background(
                        UniversePalette.surface,
                        in: RoundedRectangle(
                            cornerRadius: 14,
                            style: .continuous
                        )
                    )
                }

                metadataEditor

                if !draft.memberships.isEmpty,
                   draft.canonicalMemberships == nil {
                    Text("Enter a weight for each selected galaxy")
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                sourceEditor

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 24)
            .frame(
                maxWidth: 720,
                alignment: .leading
            )
            .frame(maxWidth: .infinity)
        }
    }

    private var metadataEditor: some View {
        VStack(
            alignment: .leading,
            spacing: 16
        ) {
            HStack(spacing: 14) {
                Menu {
                    Picker(
                        "",
                        selection: $draft.type
                    ) {
                        ForEach(
                            availableNodeTypes,
                            id: \.self
                        ) { type in
                            Text(
                                UniverseNodeOptions.typeLabel(
                                    type
                                )
                            )
                            .tag(type)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.inline)
                } label: {
                    metadataPill(
                        UniverseNodeOptions.typeLabel(
                            draft.type
                        )
                    )
                }

                Menu {
                    Picker(
                        "",
                        selection: $draft.importance
                    ) {
                        ForEach(
                            availableImportance,
                            id: \.self
                        ) { importance in
                            Text(UniverseNodeOptions.importanceLabel(importance))
                                .tag(importance)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.inline)
                } label: {
                    metadataPill(
                        UniverseNodeOptions.importanceLabel(draft.importance)
                    )
                }
            }

            editorField(
                title: "Tags"
            ) {
                TextField(
                    "e.g. Reflection, Learning",
                    text: $draft.tagsText
                )
            }

            VStack(
                alignment: .leading,
                spacing: 12
            ) {
                Text("Galaxies")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)

                ForEach(
                    galaxies.sorted {
                        $0.order < $1.order
                    }
                ) { galaxy in
                    galaxyMembershipRow(galaxy)
                }
            }
        }
    }

    private var sourceEditor: some View {
        VStack(
            alignment: .leading,
            spacing: 10
        ) {
            HStack {
                Text("Source Diaries (Optional)")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)

                Spacer()

                Button {
                    sourcePickerPresented = true
                } label: {
                    Label(
                        "Add",
                        systemImage: "plus"
                    )
                }
                .font(.subheadline)
            }

            if draft.sourceDiaryIDs.isEmpty {
                Text("No source diaries")
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
            } else {
                ForEach(
                    draft.sourceDiaryIDs,
                    id: \.self
                ) { diaryID in
                    HStack(spacing: 10) {
                        VStack(
                            alignment: .leading,
                            spacing: 2
                        ) {
                            Text(
                                sourceMetadata[
                                    diaryID
                                ]?.title
                                    ?? diaryID
                            )
                            .lineLimit(1)

                            if let date =
                                sourceMetadata[
                                    diaryID
                                ]?.date {
                                Text(
                                    sourceDate(date)
                                )
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                        }

                        Spacer()

                        Button {
                            draft.sourceDiaryIDs
                                .removeAll {
                                    $0 == diaryID
                                }
                        } label: {
                            Image(
                                systemName:
                                    "xmark.circle.fill"
                            )
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                    }
                    .padding(12)
                    .background(
                        UniversePalette.surface,
                        in: RoundedRectangle(
                            cornerRadius: 12,
                            style: .continuous
                        )
                    )
                }
            }
        }
    }

    private func editorField<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(
            alignment: .leading,
            spacing: 7
        ) {
            Text(title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)

            content()
                .padding(
                    .horizontal,
                    12
                )
                .padding(
                    .vertical,
                    11
                )
                .background(
                    UniversePalette.surface,
                    in: RoundedRectangle(
                        cornerRadius: 12,
                        style: .continuous
                    )
                )
        }
    }

    private func galaxyMembershipRow(
        _ galaxy: UniverseGalaxy
    ) -> some View {
        let index = draft.memberships
            .firstIndex {
                $0.id == galaxy.id
            }
        let enabled = index != nil

        return VStack(
            alignment: .leading,
            spacing: 8
        ) {
            Toggle(
                isOn: Binding(
                    get: {
                        draft.memberships
                            .contains {
                                $0.id == galaxy.id
                            }
                    },
                    set: { selected in
                        if selected {
                            if !draft.memberships
                                .contains(
                                    where: {
                                        $0.id
                                            == galaxy.id
                                    }
                                ) {
                                draft.memberships
                                    .append(
                                        .init(
                                            id: galaxy.id,
                                            weightText:
                                                ""
                                        )
                                    )
                            }
                        } else {
                            draft.memberships
                                .removeAll {
                                    $0.id == galaxy.id
                                }
                        }
                    }
                )
            ) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(
                            UniversePalette.color(
                                hex: galaxy.color
                            )
                        )
                        .frame(
                            width: 8,
                            height: 8
                        )

                    Text(galaxy.title)
                }
            }

            if enabled,
               let currentIndex =
                    draft.memberships
                        .firstIndex(
                            where: {
                                $0.id == galaxy.id
                            }
                        ) {
                HStack {
                    Text("Weight")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Spacer()

                    TextField(
                        "50",
                        text: Binding(
                            get: {
                                draft.memberships[
                                    currentIndex
                                ].percentText
                            },
                            set: { value in
                                let normalized =
                                    value.replacingOccurrences(
                                        of: "％",
                                        with: ""
                                    )
                                    .replacingOccurrences(
                                        of: "%",
                                        with: ""
                                    )
                                if normalized
                                    .trimmingCharacters(
                                        in:
                                            .whitespacesAndNewlines
                                    )
                                    .isEmpty {
                                    draft.memberships[
                                        currentIndex
                                    ].weightText = ""
                                } else if let percent =
                                    Double(normalized) {
                                    draft.memberships[
                                        currentIndex
                                    ].weightText =
                                        UniverseNodeDraft
                                            .canonicalWeightText(
                                                fromPercent:
                                                    percent
                                            )
                                } else {
                                    draft.memberships[
                                        currentIndex
                                    ].weightText =
                                        normalized
                                }
                            }
                        )
                    )
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 72)

                    Text("%")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.leading, 28)
            }
        }
        .padding(12)
        .background(
            UniversePalette.surface,
            in: RoundedRectangle(
                cornerRadius: 12,
                style: .continuous
            )
        )
    }
}
