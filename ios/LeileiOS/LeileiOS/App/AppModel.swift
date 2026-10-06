import Foundation
import CryptoKit
import Combine
import Auth0

@MainActor
final class AppModel: ObservableObject {
    enum ChatSyncState: Equatable {
        case idle
        case loading
        case ready
        case unavailable(String)
    }

    enum ConversationBootstrapState: Equatable {
        case idle
        case loading
        case ready
        case unavailable(String)
    }

    enum ChatSendState: Equatable {
        case idle
        case sending
        case failed
    }

    enum ProbeState: Equatable {
        case idle
        case checking
        case reachable(String)
        case unavailable(String)

        var label: String {
            switch self {
            case .idle:
                return "Not checked"
            case .checking:
                return "Checking…"
            case .reachable(let status):
                return status
            case .unavailable(let message):
                return message
            }
        }
    }

    let nativeLiveAttachmentBytesCache = NativeLiveAttachmentBytesCache(diskRoot:
        FileManager.default.urls(for:.cachesDirectory,in:.userDomainMask).first?
            .appendingPathComponent("LeileiOS-MediaOriginal",isDirectory:true))
    let config: AppConfig
    let authSession: AuthSessionController
    let api: LeileiAPIClient

    @Published var backendState: ProbeState = .idle
    @Published var sessionState: ProbeState = .idle
    @Published var isAuthenticated = false
    @Published var accountEmail: String?

    @Published var activeNativeLiveConversationID: UUID?
    @Published var nativeLiveConversations: [NativeLiveConversationSummary] = []
    @Published var nativeLiveConversationNextCursor: String?
    @Published var conversationBootstrapState: ConversationBootstrapState = .idle
    @Published var nativeLiveArchivedConversations: [NativeLiveConversationSummary] = []
    @Published var nativeLiveArchivedConversationNextCursor: String?
    @Published var archivedConversationBootstrapState: ConversationBootstrapState = .idle
    @Published var nativeLiveCurrentPath: NativeLiveCurrentPathSnapshot? { didSet { reconcileNativeLivePresentation() } }
    @Published var nativeLiveHistorySnapshot:
        NativeLiveConversationHistorySnapshot? { didSet { reconcileNativeLivePresentation() } }
    @Published var chatSyncState: ChatSyncState = .idle
    @Published var chatSendState: ChatSendState = .idle
    @Published var nativeLiveRuntimeMetadata: NativeLiveRuntimeMetadata?
    @Published var nativeLiveRuntimeSurface:
        NativeLiveRuntimeSurfaceState? { didSet { reconcileNativeLivePresentation() } }
    @Published var nativeLiveBackgroundRuntimeSurfaces:
        [String: NativeLiveRuntimeSurfaceState] = [:] { didSet { reconcileNativeLivePresentation() } }
    @Published var nativeLivePendingOperation: NativeLivePendingOperation? { didSet { reconcileNativeLivePresentation() } }
    @Published var nativeLiveConversationRows: [NativeLiveConversationRowPresentation] = []
    @Published var nativeLiveMessageUIState = NativeLiveMessageUIStateStore()
    var nativeLiveTurnIdentities = NativeLiveTurnIdentityCoordinator()
    var nativeLivePresentationAssembler = NativeLiveConversationPresentationAssembler()
    @Published var mindWritesByMessageID:
        [String: MindProductMessageWriteProjection] = [:]
    @Published var albumSavesByUserMessageID:
        [String: ClaudeAlbumMessageSaveProjection] = [:]

    var nativeLiveRuntimeMetadataByConversationID:
        [UUID: NativeLiveRuntimeMetadata] = [:]
    var nativeLiveRuntimeObservationTask: Task<Void, Never>?
    var nativeLiveConversationHeadObservationTask:
        Task<Void, Never>?
    var nativeLiveBackgroundObservationTasks:
        [String: Task<Void, Never>] = [:]
    var nativeLiveBackgroundSurfaceOrder: [String] = []
    var mindWriteRequestsInFlight: Set<String> = []
    var albumSaveRequestsInFlight: Set<String> = []
    var currentHeadMindWriteRefreshTask: Task<Void, Never>?
    var conversationBootstrapInFlight = false
    var conversationPaginationInFlight = false
    var archivedConversationBootstrapInFlight = false
    var archivedConversationPaginationInFlight = false
    var chatRefreshInFlight = false
    var chatOlderHistoryInFlight = false
    var chatRefreshPendingForce = false
    var chatSendInFlight = false
    static let activeNativeLiveConversationDefaultsKey =
        "activeNativeLiveConversationID"

    init() {
        let config = AppConfig.production()
        let authSession = AuthSessionController(config: config)

        self.config = config
        self.authSession = authSession
        self.api = LeileiAPIClient(
            baseURL: config.apiBaseURL,
            authSession: authSession
        )

        let storedConversationID = UserDefaults.standard.string(
            forKey: Self.activeNativeLiveConversationDefaultsKey
        )
        let debugConversationID = ProcessInfo.processInfo.environment[
            "LEILEI_NATIVE_LIVE_CONVERSATION_ID"
        ]
        if let rawConversationID = storedConversationID ?? debugConversationID,
           let conversationID = UUID(uuidString: rawConversationID) {
            self.activeNativeLiveConversationID = conversationID
        }

        // Retire the old access-token-only Keychain entry.
        try? KeychainAccessTokenStore().clear()
    }

    func clearNativeLiveSessionData() {
        nativeLiveConversations = []
        nativeLiveConversationNextCursor = nil
        conversationBootstrapState = .idle
        nativeLiveArchivedConversations = []
        nativeLiveArchivedConversationNextCursor = nil
        archivedConversationBootstrapState = .idle
        nativeLiveCurrentPath = nil
        nativeLiveHistorySnapshot = nil
        nativeLiveRuntimeMetadata = nil
        nativeLiveRuntimeMetadataByConversationID.removeAll()
        mindWritesByMessageID.removeAll()
        mindWriteRequestsInFlight.removeAll()
        albumSavesByUserMessageID.removeAll()
        albumSaveRequestsInFlight.removeAll()
        currentHeadMindWriteRefreshTask?.cancel()
        currentHeadMindWriteRefreshTask = nil
        nativeLiveRuntimeObservationTask?.cancel()
        nativeLiveRuntimeObservationTask = nil
        nativeLiveConversationHeadObservationTask?.cancel()
        nativeLiveConversationHeadObservationTask = nil
        for task in nativeLiveBackgroundObservationTasks.values {
            task.cancel()
        }
        nativeLiveBackgroundObservationTasks.removeAll()
        nativeLiveBackgroundSurfaceOrder.removeAll()
        nativeLiveRuntimeSurface = nil
        nativeLiveBackgroundRuntimeSurfaces.removeAll()
        nativeLivePendingOperation = nil
        nativeLiveTurnIdentities = .init()
        nativeLivePresentationAssembler = .init()
        nativeLiveMessageUIState = .init()
        nativeLiveConversationRows = []
        chatSyncState = .idle
        conversationPaginationInFlight = false
        archivedConversationBootstrapInFlight = false
        archivedConversationPaginationInFlight = false
        chatRefreshInFlight = false
        chatOlderHistoryInFlight = false
        chatRefreshPendingForce = false
        chatSendState = .idle
    }

}

enum NativeLiveSendError: LocalizedError {
    case notReady
    case invalidText
    case interrupted
    case failed(code: String?)
    case completionUnknown

    var errorDescription: String? {
        switch self {
        case .notReady:
            return "Conversation is not ready."
        case .invalidText:
            return "Message must contain between 1 and 4000 characters."
        case .interrupted:
            return "Turn interrupted."
        case .failed(let code):
            return code ?? "Failed"
        case .completionUnknown:
            return "Turn completion is unknown."
        }
    }
}
