import SwiftUI
import Combine

@MainActor private final class NativeLiveSVGLoadState: ObservableObject {
    @Published private var state = NativeLiveSVGLoadingState()
    var input: NativeLiveVisualSandboxInput? { state.input }
    var verified: NativeLiveLoadedAttachment? { state.verified }
    var error: String? { state.error }
    var loading: Bool { state.loading }
    func load(_ descriptor: NativeLiveAttachmentPresentationInput, appModel: AppModel) async {
        let generation = state.begin()
        do {
            guard descriptor.presentationState == .ready || descriptor.presentationState == .loaded else { throw NativeLiveVisualError.unavailable }
            // Sole download/integrity/original-cache authority remains C.
            let bytes = try await appModel.nativeLiveAttachmentBytes(descriptor)
            try Task.checkCancellation()
            state.complete(bytes, generation:generation)
        } catch is CancellationError { state.cancel(generation:generation) }
        catch { state.fail((error as? NativeLiveMediaError)?.localizedDescription ?? "SVG preview unavailable. Open the verified file.", generation:generation) }
    }
}

struct NativeLiveSVGRenderer: View {
    @EnvironmentObject private var appModel: AppModel
    let input: NativeLiveAttachmentPresentationInput
    @StateObject private var loader = NativeLiveSVGLoadState()
    @State private var retry = 0
    @State private var fullscreen = false
    @State private var lease: NativeLiveFilePreviewLease?
    @State private var openError: String?
    var body: some View {
        VStack(alignment:.leading,spacing:8) {
            Text(input.filename).font(.subheadline).accessibilityLabel(input.filename)
            if let visual = loader.input {
                NativeLiveVisualSurface(input:visual,label:input.filename,previewAction:{ fullscreen = true },embeddedInParentPanel:true)
                Button("Fullscreen preview") { fullscreen = true }.font(.caption)
            } else if loader.loading { Label("Loading SVG…",systemImage:"hourglass").font(.caption) }
            else { Text(loader.error ?? input.presentationState.rawValue).font(.caption).foregroundStyle(.secondary) }
            HStack {
                Button("Retry") { retry += 1 }
                Button("Open original") { openOriginal() }.disabled(loader.verified == nil)
            }.font(.caption)
            if let openError { Text(openError).font(.caption) }
        }
        .padding(10)
        .modifier(NativeLiveIMessageContentPanel(
            originalOpacity: 0.045,
            originalCornerRadius: 12
        ))
        .task(id: "\(input.entityID ?? input.draftID)|\(input.sha256 ?? "")|\(input.materialization)|\(retry)") { await loader.load(input,appModel:appModel) }
        .sheet(item:$lease,onDismiss:{ lease?.cleanup(); lease = nil }) { NativeLiveFileOpenView(lease:$0) }
        .fullScreenCover(isPresented:$fullscreen) {
            NavigationStack {
                ScrollView { if let visual = loader.input { NativeLiveVisualSurface(input:visual,label:input.filename) } }
                    .toolbar { ToolbarItem(placement:.topBarTrailing) { Button("Done") { fullscreen = false } } }
            }
        }
    }
    private func openOriginal() {
        guard let verified = loader.verified else { return }
        do { lease = try NativeLiveFilePreviewLease(data:verified.data,filename:input.filename,mimeType:input.mimeType); openError = nil }
        catch { openError = NativeLiveMediaError.previewFailed.localizedDescription }
    }
}

// C user media sequences and assistant/structured nodes share this registry decision.
struct NativeLiveRegisteredAttachmentView: View {
    let input: NativeLiveAttachmentPresentationInput
    var body: some View {
        if NativeLiveMessageRendererRegistry.renderer(for:input) == .svgAttachment { NativeLiveSVGRenderer(input:input) }
        else { NativeLiveMediaCard(input:input) }
    }
}
