import Foundation
import SwiftUI
import UniformTypeIdentifiers

extension UniverseView {
    func cancelPlacementForToolbarMenu() {
        if case .placingNode = mapMode {
            mapMode = .browse
            notice = nil
        }
    }

    func load() async {
        loadGeneration += 1
        let generation = loadGeneration
        mapMode = .browse
        state = .loading

        do {
            let result =
                try await UniverseAPIService(
                    api: appModel.api
                )
                .load()

            guard generation == loadGeneration else {
                return
            }

            state = .ready(result)
            await openTargetIfPossible()
        } catch {
            guard generation == loadGeneration else {
                return
            }

            if UniverseAPIService
                .isNotInitialized(error) {
                state = .notInitialized
            } else {
                state = .failed
            }
        }
    }

    func refreshReadyState() async {
        guard case .ready(let current) = state else {
            return
        }

        do {
            let fresh =
                try await UniverseAPIService(
                    api: appModel.api
                )
                .load()
            state = .ready(fresh)
        } catch {
            state = .ready(current)
        }
    }

    func showNotice(
        _ message: String
    ) {
        noticeTask?.cancel()
        noticeTask = nil

        withAnimation(.snappy) {
            notice = message
        }

        scheduleNoticeDismissal()
    }

    func scheduleNoticeDismissal() {
        noticeTask?.cancel()
        noticeTask = nil

        guard let message = notice,
              sheetSelection == nil
        else {
            return
        }

        noticeTask = Task { @MainActor in
            try? await Task.sleep(
                for: .seconds(3)
            )
            guard !Task.isCancelled,
                  notice == message,
                  sheetSelection == nil
            else {
                return
            }

            withAnimation(.snappy) {
                notice = nil
            }
            noticeTask = nil
        }
    }
}
