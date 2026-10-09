import Foundation
import SwiftUI
import UniformTypeIdentifiers

extension UniverseNodeSheet {
    @ToolbarContentBuilder
    var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button {
                if isEditing, !isCreate {
                    isEditing = false
                    resetDraft()
                } else {
                    onClose()
                }
            } label: {
                if isEditing, !isCreate {
                    Text("Cancel")
                } else {
                    Image(systemName: "xmark")
                }
            }
            .disabled(isSaving)
        }

        ToolbarItemGroup(placement: .topBarTrailing) {
            if isEditing {
                if let node, !isCreate {
                    Menu {
                        if revisionsAvailable {
                            Button {
                                Task {
                                    await restore(node)
                                }
                            } label: {
                                Label(
                                    "Restore Previous Version",
                                    systemImage: "clock.arrow.circlepath"
                                )
                            }
                        }

                        Button(
                            role: .destructive
                        ) {
                            deletePresented = true
                        } label: {
                            Label(
                                "Delete",
                                systemImage: "trash"
                            )
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                    .accessibilityLabel("Node actions")
                    .disabled(isSaving)
                }

                Button {
                    Task {
                        await save()
                    }
                } label: {
                    if isSaving {
                        ProgressView()
                    } else {
                        Text(
                            isCreate
                                ? "Add"
                                : "Done"
                        )
                    }
                }
                .disabled(!canSave)
            } else if let node {
                Button {
                    relationPresented = true
                } label: {
                    Image(systemName: "link")
                }
                .accessibilityLabel("Add Connection")
                .disabled(isSaving)

                Button("Edit") {
                    resetDraft()
                    isEditing = true
                }
                .disabled(isSaving)

                Menu {
                    if revisionsAvailable {
                        Button {
                            Task {
                                await restore(node)
                            }
                        } label: {
                            Label(
                                "Restore Previous Version",
                                systemImage: "clock.arrow.circlepath"
                            )
                        }
                    }

                    Button(
                        role: .destructive
                    ) {
                        deletePresented = true
                    } label: {
                        Label(
                            "Delete",
                            systemImage: "trash"
                        )
                    }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel("Node actions")
                .disabled(isSaving)
            }
        }
    }
}
