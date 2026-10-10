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
                Menu {
                    Button("Add Connection") {
                        relationPresented = true
                    }

                    Button("Edit") {
                        resetDraft()
                        isEditing = true
                    }

                    Button("Delete", role: .destructive) {
                        confirmation = .deleteNode
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
