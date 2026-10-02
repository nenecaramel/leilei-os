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
                    Text("取消")
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
                                    "恢复上一版本",
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
                                "让它离开宇宙",
                                systemImage: "trash"
                            )
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                    .accessibilityLabel("更多星球操作")
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
                                ? "点亮"
                                : "保存"
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
                .accessibilityLabel("建立思想连接")
                .disabled(isSaving)

                Button("编辑") {
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
                                "恢复上一版本",
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
                            "让它离开宇宙",
                            systemImage: "trash"
                        )
                    }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel("更多星球操作")
                .disabled(isSaving)
            }
        }
    }
}
