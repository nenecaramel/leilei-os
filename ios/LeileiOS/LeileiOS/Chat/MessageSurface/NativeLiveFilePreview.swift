import SwiftUI
import QuickLook

struct NativeLiveFilePreview: UIViewControllerRepresentable {
    let lease: NativeLiveFilePreviewLease
    func makeCoordinator() -> Coordinator { Coordinator(lease:lease) }
    func makeUIViewController(context:Context) -> UINavigationController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        controller.navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem:.done,target:context.coordinator,action:#selector(Coordinator.close))
        context.coordinator.controller = controller
        return UINavigationController(rootViewController:controller)
    }
    func updateUIViewController(_ controller:UINavigationController,context:Context) {}
    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let lease: NativeLiveFilePreviewLease
        weak var controller: QLPreviewController?
        init(lease:NativeLiveFilePreviewLease) { self.lease = lease }
        @objc func close() { controller?.dismiss(animated:true) }
        func numberOfPreviewItems(in controller:QLPreviewController) -> Int { 1 }
        func previewController(_ controller:QLPreviewController,previewItemAt index:Int) -> QLPreviewItem { lease.fileURL as NSURL }
    }
}

struct NativeLiveFileOpenView: View {
    @Environment(\.dismiss) private var dismiss
    let lease: NativeLiveFilePreviewLease
    var body: some View {
        if QLPreviewController.canPreview(lease.fileURL as NSURL) {
            NativeLiveFilePreview(lease:lease)
        } else {
            NavigationStack {
                VStack(spacing:20) {
                    Text(lease.fileURL.lastPathComponent).lineLimit(3).truncationMode(.middle)
                    Text("A preview is unavailable for this file. You can save or share the verified original.").foregroundStyle(.secondary)
                    ShareLink(item:lease.fileURL) { Label("Save or share file",systemImage:"square.and.arrow.up") }
                }.padding()
                .toolbar { ToolbarItem(placement:.topBarTrailing) { Button("Done") { dismiss() } } }
            }
        }
    }
}
