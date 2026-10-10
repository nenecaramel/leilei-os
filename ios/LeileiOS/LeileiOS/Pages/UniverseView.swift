import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct UniverseView: View {
    @EnvironmentObject var appModel: AppModel

    let targetNodeID: String?
    let onTargetConsumed: () -> Void

    @State var state: UniversePageState = .loading
    @State var selectedNodeID: String?
    @State var activeGalaxyID: String?
    @State var mapMode: UniverseMapMode = .browse
    @State var sheetSelection: UniverseSheetSelection?
    @State var notice: String?
    @State var noticeTask: Task<Void, Never>?
    @State var loadGeneration = 0

    @State var importPresented = false
    @State var importPreview: UniverseImportPreview?
    @State var importFileName: String?
    @State var importError: String?
    @State var importUncertain = false
    @State var importCommitting = false

    @State var exportPresented = false
    @State var exportDocument: UniverseJSONDocument?
    @State var exportFilename = "Universe Backup"

    init(
        targetNodeID: String? = nil,
        onTargetConsumed: @escaping () -> Void = {}
    ) {
        self.targetNodeID = targetNodeID
        self.onTargetConsumed = onTargetConsumed
    }

    var body: some View {
        Group {
            switch state {
            case .loading:
                universeLoading

            case .notInitialized:
                universeImport

            case .failed:
                universeFailure

            case .ready(let result):
                universeReady(result)
            }
        }
        .frame(
            maxWidth: .infinity,
            maxHeight: .infinity
        )
        .background(
            UniversePalette.background
                .ignoresSafeArea()
        )
        .environment(\.colorScheme, .dark)
        .toolbar {
            if case .ready = state {
                readyToolbar()
            }
        }
        .fullScreenCover(
            item: nodeDetailSelection
        ) { selection in
            nodeSheet(selection)
                .presentationBackground(
                    UniversePalette.background
                )
        }
        .sheet(item: nodeCreateSelection) { selection in
            nodeSheet(selection)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(UniversePalette.background)
        }
        .fileImporter(
            isPresented: $importPresented,
            allowedContentTypes: [.json],
            allowsMultipleSelection: false
        ) { result in
            handleImportedFile(result)
        }
        .fileExporter(
            isPresented: $exportPresented,
            document: exportDocument,
            contentType: .json,
            defaultFilename: exportFilename
        ) { result in
            if case .failure = result {
                showNotice("Unable to export.")
            }
            exportDocument = nil
        }
        .task {
            await load()
        }
        .task(id: targetNodeID) {
            await openTargetIfPossible()
        }
        .onChange(of: sheetSelection) { _, selection in
            if selection == nil {
                scheduleNoticeDismissal()
            } else {
                noticeTask?.cancel()
                noticeTask = nil
            }
        }
        .onDisappear {
            noticeTask?.cancel()
            noticeTask = nil
        }
    }
}
