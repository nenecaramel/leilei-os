import Foundation
import SwiftUI
import UniformTypeIdentifiers

extension UniverseNodeSheet {
    @ToolbarContentBuilder
    func toolbarContent(editing: Bool) -> some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button {
                cancel()
            } label: {
                if editing {
                    Text("Cancel")
                } else {
                    Image(systemName: "xmark")
                        .accessibilityLabel("Close")
                }
            }
            .disabled(isSaving)
        }

        ToolbarItemGroup(placement: .topBarTrailing) {
            if editing {
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
            } else if node != nil {
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
                            confirmation = .restoreVersion
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
                        confirmation = .deleteNode
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
